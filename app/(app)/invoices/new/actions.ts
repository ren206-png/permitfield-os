'use server';

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createDraftInvoice } from '@/lib/quotes-payments/invoices';
import { parseCurrencyToCents, parseDecimalQuantity } from '@/lib/money/cents';
import type { LineItemDraftInput } from '@/lib/quotes-payments/types';

// Gate 4 (Quotes & Payments), Phase A. Same double-gate discipline as
// app/(app)/estimates/new/actions.ts: flag first (notFound()), then
// 'invoices.manage' checked here AND again inside createDraftInvoice()
// itself.
export interface NewInvoiceState {
  error?: string;
}

/** Mirrors app/(app)/estimates/new/actions.ts's parseLineItems() exactly -- same same-named-repeated-fields encoding, same skip-wholly-blank-row treatment. Kept as its own copy rather than a shared import: it's a small, form-shaped parser tied 1:1 to its own form's field names, not a general-purpose utility. */
function parseLineItems(formData: FormData): { items: LineItemDraftInput[] } | { error: string } {
  const descriptions = formData.getAll('description').map((v) => String(v).trim());
  const quantities = formData.getAll('quantity').map((v) => String(v).trim());
  const unitPrices = formData.getAll('unitPrice').map((v) => String(v).trim());
  const discountPercents = formData.getAll('discountPercent').map((v) => String(v).trim());

  const items: LineItemDraftInput[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i];
    const quantityRaw = quantities[i] ?? '';
    const unitPriceRaw = unitPrices[i] ?? '';
    const discountPercentRaw = discountPercents[i] ?? '';

    if (!description && !quantityRaw && !unitPriceRaw) continue;

    if (!description) return { error: `Line item ${i + 1} is missing a description.` };

    const quantity = parseDecimalQuantity(quantityRaw);
    if (!quantity) return { error: `Line item ${i + 1} has an invalid quantity.` };

    const unitPriceCents = parseCurrencyToCents(unitPriceRaw);
    if (unitPriceCents === null || unitPriceCents < 0n) {
      return { error: `Line item ${i + 1} has an invalid unit price.` };
    }

    items.push({
      description,
      quantity: quantityRaw,
      unitPriceCents,
      discountPercent: discountPercentRaw || null,
      position: i,
    });
  }
  return { items };
}

export async function createInvoiceAction(
  _prevState: NewInvoiceState,
  formData: FormData
): Promise<NewInvoiceState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();

  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const clientId = String(formData.get('clientId') ?? '').trim();
  const projectId = String(formData.get('projectId') ?? '').trim();
  const sourceEstimateId = String(formData.get('sourceEstimateId') ?? '').trim();
  const dueDate = String(formData.get('dueDate') ?? '').trim();
  const scopeNotes = String(formData.get('scopeNotes') ?? '').trim();
  const terms = String(formData.get('terms') ?? '').trim();

  if (!clientId) {
    return { error: 'Select a client.' };
  }

  const parsedLineItems = parseLineItems(formData);
  if ('error' in parsedLineItems) {
    return { error: parsedLineItems.error };
  }

  const supabase = await createClient();

  // Re-derive every foreign key from the DB rather than trusting the
  // client-submitted option values, same discipline
  // app/(app)/estimates/new/actions.ts's createEstimateAction documents.
  const { data: client } = await supabase.from('clients').select('id').eq('id', clientId).eq('org_id', orgId).maybeSingle();
  if (!client) {
    return { error: 'Selected client was not found in your organization.' };
  }
  if (projectId) {
    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('org_id', orgId).maybeSingle();
    if (!project) {
      return { error: 'Selected project was not found in your organization.' };
    }
  }
  if (sourceEstimateId) {
    const { data: estimate } = await supabase
      .from('estimates')
      .select('id')
      .eq('id', sourceEstimateId)
      .eq('org_id', orgId)
      .eq('status', 'accepted')
      .maybeSingle();
    if (!estimate) {
      return { error: 'Selected source estimate was not found, or is not in an accepted state.' };
    }
  }

  let invoice;
  try {
    invoice = await createDraftInvoice(supabase, {
      orgId,
      clientId,
      projectId: projectId || null,
      sourceEstimateId: sourceEstimateId || null,
      dueDate: dueDate || null,
      scopeNotes: scopeNotes || null,
      terms: terms || null,
      lineItems: parsedLineItems.items,
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create the invoice.' };
  }

  redirect(`/invoices/${invoice.id}`);
}
