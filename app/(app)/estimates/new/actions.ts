'use server';

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createDraftEstimate } from '@/lib/quotes-payments/estimates';
import { parseCurrencyToCents, parseDecimalQuantity } from '@/lib/money/cents';
import type { LineItemDraftInput } from '@/lib/quotes-payments/types';

// Gate 4 (Quotes & Payments), Phase A. Double-gated same as
// app/(app)/projects/new/actions.ts's createProjectAction: flag first
// (notFound() -- a direct POST with the flag off gets treated as a route
// that doesn't exist), then the 'quotes.manage' entitlement (checked here
// AND again inside createDraftEstimate() itself -- this Server Action is a
// public, directly-invokable endpoint independent of the page that renders
// it, same discipline app/(app)/settings/billing/actions.ts's header
// comment documents).
export interface NewEstimateState {
  error?: string;
}

/**
 * Line items are submitted as same-named repeated fields
 * (`description`/`quantity`/`unitPrice`/`discountPercent`, one value per
 * row, in row order) rather than indexed keys -- FormData.getAll()
 * preserves submission order, and this is the simplest encoding for a
 * client-managed variable-length row list with no existing precedent
 * elsewhere in this codebase to follow instead.
 */
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

    // A wholly blank row (no description, no quantity, no price) is a
    // no-op the client-side "add row" control leaves behind -- skipped
    // rather than rejected, same "empty means not yet known" treatment
    // app/(app)/applications/new/actions.ts gives its own optional field.
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

export async function createEstimateAction(
  _prevState: NewEstimateState,
  formData: FormData
): Promise<NewEstimateState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();

  if (!(await can(orgId, 'quotes.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const clientId = String(formData.get('clientId') ?? '').trim();
  const projectId = String(formData.get('projectId') ?? '').trim();
  const expiryDate = String(formData.get('expiryDate') ?? '').trim();
  const scopeNotes = String(formData.get('scopeNotes') ?? '').trim();
  const exclusions = String(formData.get('exclusions') ?? '').trim();
  const terms = String(formData.get('terms') ?? '').trim();

  if (!clientId) {
    return { error: 'Select a client.' };
  }

  const parsedLineItems = parseLineItems(formData);
  if ('error' in parsedLineItems) {
    return { error: parsedLineItems.error };
  }

  const supabase = await createClient();

  // Re-derive client_id/project_id from the DB rather than trusting the
  // client-submitted option values, same discipline
  // app/(app)/applications/new/actions.ts's createApplicationAction
  // documents for its own contractor_id/permit_type_id re-check.
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

  let estimate;
  try {
    estimate = await createDraftEstimate(supabase, {
      orgId,
      clientId,
      projectId: projectId || null,
      expiryDate: expiryDate || null,
      scopeNotes: scopeNotes || null,
      exclusions: exclusions || null,
      terms: terms || null,
      lineItems: parsedLineItems.items,
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create the estimate.' };
  }

  redirect(`/estimates/${estimate.id}`);
}
