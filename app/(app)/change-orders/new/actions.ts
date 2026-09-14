'use server';

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createDraftChangeOrder } from '@/lib/quotes-payments/change-orders';
import { parseCurrencyToCents, parseDecimalQuantity } from '@/lib/money/cents';
import type { LineItemDraftInput } from '@/lib/quotes-payments/types';

// Gate 4 (Quotes & Payments), Phase B. Same double-gate discipline as
// app/(app)/invoices/new/actions.ts's createInvoiceAction: flag re-checked
// first (notFound()), 'invoices.manage' re-checked here AND again inside
// createDraftChangeOrder() itself.
export interface NewChangeOrderState {
  error?: string;
}

/** Mirrors app/(app)/invoices/new/actions.ts's parseLineItems() exactly -- same same-named-repeated-fields encoding, same skip-wholly-blank-row treatment. Kept as its own copy for the same "small, form-shaped, not a shared utility" reason that file's own comment states. */
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

export async function createChangeOrderAction(
  _prevState: NewChangeOrderState,
  formData: FormData
): Promise<NewChangeOrderState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();

  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const sourceInvoiceId = String(formData.get('sourceInvoiceId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  if (!sourceInvoiceId) {
    return { error: 'Missing source invoice id.' };
  }
  if (!title) {
    return { error: 'Give this change order a title.' };
  }

  const parsedLineItems = parseLineItems(formData);
  if ('error' in parsedLineItems) {
    return { error: parsedLineItems.error };
  }

  const supabase = await createClient();

  // Re-derive the client from the source invoice rather than trusting a
  // hidden form field, same discipline every other Server Action in this
  // gate follows for foreign keys. Only an issued invoice may have a change
  // order proposed against it -- per
  // GATE_4_PHASE_B_FINDINGS.md §III Q1, a change order always targets an
  // already-issued invoice (a pre-issuance change is just an edit to the
  // still-draft invoice itself, no change_orders row involved).
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, client_id, status')
    .eq('id', sourceInvoiceId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (invoiceError) {
    return { error: `Failed to load source invoice: ${invoiceError.message}` };
  }
  if (!invoice) {
    return { error: 'Source invoice was not found in your organization.' };
  }
  if (invoice.status !== 'issued') {
    return { error: 'Change orders can only be created against an issued invoice.' };
  }

  let changeOrder;
  try {
    changeOrder = await createDraftChangeOrder(supabase, {
      orgId,
      clientId: invoice.client_id,
      sourceInvoiceId,
      title,
      description: description || null,
      lineItems: parsedLineItems.items,
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create the change order.' };
  }

  redirect(`/change-orders/${changeOrder.id}`);
}
