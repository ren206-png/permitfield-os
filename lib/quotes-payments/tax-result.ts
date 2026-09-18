// Gate 4 (Quotes & Payments), Phase A service layer -- the single place
// estimates.ts and invoices.ts both call to go from "an org + a set of
// draft line items" to either a computed TaxCalculationOk or a
// review-required outcome, so the two lifecycle modules can't silently
// drift into two different orderings of "load tax profile, then
// calculateTax(), then decide what to do." Never reimplements any of
// lib/tax/engine.ts's math -- this file's only job is wiring
// resolveOrgTaxContext() + calculateTax() together and giving the combined
// result one shared, richer union type.
import { calculateTax } from '@/lib/tax/engine';
import type { TaxCalculationOk, TaxLineItemBreakdown, TaxLineItemInput, TaxReviewReason } from '@/lib/tax/types';
import { resolveOrgTaxContext } from './tax-context';
import type { QPClient } from './types';

/**
 * Superset of lib/tax/types.ts's `TaxReviewReason` -- adds
 * `'missing_tax_profile'` for the case this service layer detects BEFORE
 * calculateTax() ever runs (no org_tax_profiles row at all; see
 * tax-context.ts's header comment for why that's kept distinct from an
 * existing row's `'unknown'` status values, which DO map to
 * calculateTax()'s own `'unknown_gst_hst_status'`/`'unknown_bc_pst_status'`
 * reasons).
 */
export type QuotesPaymentsReviewReason = TaxReviewReason | 'missing_tax_profile';

export type QuotesPaymentsTaxOutcome =
  | { status: 'ok'; result: TaxCalculationOk }
  | { status: 'review_required'; reason: QuotesPaymentsReviewReason; message: string };

/**
 * Loads the org's tax profile and runs calculateTax() over `lineItems`.
 * Never throws for a legitimate "can't determine tax treatment" case --
 * those are `'review_required'` results, per the master prompt's explicit
 * "must never silently resolve to a number, must surface to the caller"
 * requirement. Still propagates a genuine DB error (via
 * resolveOrgTaxContext()'s own throw) and a genuine caller-bug TypeError
 * (via calculateTax()'s own throws for malformed line items) -- neither of
 * those is swallowed here.
 */
export async function computeTaxOutcome(
  supabase: QPClient,
  orgId: string,
  lineItems: readonly TaxLineItemInput[]
): Promise<QuotesPaymentsTaxOutcome> {
  const taxContext = await resolveOrgTaxContext(supabase, orgId);

  if (taxContext.status === 'missing_profile') {
    return {
      status: 'review_required',
      reason: 'missing_tax_profile',
      message: `Org ${orgId} has no org_tax_profiles row yet; tax treatment cannot be determined without human review.`,
    };
  }

  const result = calculateTax(lineItems, taxContext.context);
  if (result.status === 'review_required') {
    return { status: 'review_required', reason: result.reason, message: result.message };
  }
  return { status: 'ok', result };
}

/** JSON-safe (no BigInt) projection of one computed line-item breakdown, for the *_line_items jsonb snapshot params send_estimate()/issue_invoice() expect. */
export function serializeLineItemBreakdown(breakdown: TaxLineItemBreakdown): Record<string, unknown> {
  return {
    id: breakdown.id ?? null,
    description: breakdown.description,
    quantity: breakdown.quantity,
    unit_price_cents: Number(breakdown.unitPriceCents),
    line_subtotal_cents: Number(breakdown.lineSubtotalCents),
    line_discount_cents: Number(breakdown.lineDiscountCents),
    line_net_cents: Number(breakdown.lineNetCents),
    gst_hst_cents: Number(breakdown.gstHstCents),
    pst_cents: Number(breakdown.pstCents),
    line_total_cents: Number(breakdown.lineTotalCents),
  };
}

export function serializeLineItemBreakdowns(breakdowns: readonly TaxLineItemBreakdown[]): Record<string, unknown>[] {
  return breakdowns.map(serializeLineItemBreakdown);
}
