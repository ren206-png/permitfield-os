// Gate 4 (Quotes & Payments), Phase A: AB/ON/BC sales-tax + line-item
// totaling domain engine.
//
// Framework-free, pure, DB-free -- no Supabase client, no React, no API
// route. Consumed later by a service layer that reads/writes
// estimate_line_items / invoice_line_items / org_tax_profiles rows and
// passes their fields straight into calculateTax() below, then persists the
// result's totals into estimates/invoices' *_cents columns (see
// 20260806000052_estimates.sql and 20260806000054_invoices.sql's own header
// comments: "no calculation logic in SQL", totals are computed here and
// passed in already-computed).
//
// ============================================================================
// ROUNDING ORDER -- the exact, deterministic sequence this module implements
// ============================================================================
//
// This is the single source of truth for how a number is derived. Every step
// below rounds to the nearest whole cent using round-half-up (a tie rounds
// up, never to "even"/banker's rounding, never down) -- see
// lib/money/cents.ts's `roundFractionToCents` header comment for why that
// specific tie-break rule was picked (the simpler, more universally expected
// customer-facing convention, and the one implied by
// 20260806000052_estimates.sql's own comment: "line_subtotal_cents =
// round(quantity * unit_price_cents)", which does not qualify "round" any
// further, so this module treats round-half-up as filling that gap rather
// than silently picking banker's rounding instead).
//
// PER LINE ITEM (in this exact order -- nothing here is reordered per
// province or per tax type):
//
//   1. lineSubtotalCents = round(quantity * unitPriceCents)
//      Quantity is an exact BigInt numerator/denominator pair (see
//      lib/money/cents.ts's parseDecimalQuantity), never a float, so this
//      multiplication introduces zero floating-point error before the
//      single, deliberate round-to-cents step.
//
//   2. Discount, applied to lineSubtotalCents (matching
//      20260806000052_estimates.sql's own documented discount-order contract
//      verbatim -- that migration's header comment is the authoritative
//      source for this sequence, restated here as the implementation):
//        - if discountPercent is set: lineDiscountCents =
//          round(lineSubtotalCents * discountPercent / 100)
//        - if discountFixedCents is set: lineDiscountCents =
//          min(discountFixedCents, lineSubtotalCents) (never negative, never
//          exceeds the line it's discounting)
//        - if neither is set: lineDiscountCents = 0
//      lineNetCents = lineSubtotalCents - lineDiscountCents
//
//   3. Tax, computed on lineNetCents -- i.e. AFTER the discount, not before.
//      This is a deliberate legal/correctness choice, not an arbitrary
//      pick: GST/HST/PST in Canada are charged on the consideration actually
//      paid for a supply, which is the post-discount price when a discount
//      is given at the time of sale (the common case a discount_percent/
//      discount_fixed_cents column on a line item represents) -- taxing the
//      pre-discount subtotal would overcharge tax on money the customer
//      never paid. `estimate_revisions`/`invoices` storing
//      subtotal_cents (pre-discount) and discount_total_cents as SEPARATE
//      columns from tax_total_cents is consistent with this: subtotal minus
//      discount is the taxable base, and tax is layered on top of THAT.
//
//      GST/HST and BC PST are each rounded INDEPENDENTLY per line, from
//      lineNetCents, before being added to anything else -- never derived
//      from each other, never rounded once and split. This is required
//      because they are legally independent taxes (GATE_4_FINDINGS.md §I
//      item 7 / §9 risk 5's "never infer one from the other" rule) that
//      happen to share the same taxable base in BC:
//        - gstHstCents = round(lineNetCents * gstHstRatePercent / 100), or 0
//          if the org is unregistered for GST/HST on this province.
//        - pstCents (BC only) = round(lineNetCents * pstRatePercent / 100),
//          or 0 if the org is unregistered for BC PST. Always 0 outside BC.
//
//   4. lineTotalCents = lineNetCents + gstHstCents + pstCents
//
// INVOICE/ESTIMATE LEVEL -- SUM THE ALREADY-ROUNDED PER-LINE VALUES, DO NOT
// RE-ROUND A SUMMED SUBTOTAL:
//
//   subtotalCents      = sum(lineSubtotalCents)   -- pre-discount, pre-tax
//   discountTotalCents = sum(lineDiscountCents)
//   gstHstTotalCents    = sum(gstHstCents)
//   pstTotalCents       = sum(pstCents)
//   taxTotalCents       = gstHstTotalCents + pstTotalCents
//   totalCents          = subtotalCents - discountTotalCents + taxTotalCents
//                        (identically, sum(lineTotalCents) -- both are
//                        asserted equal in engine.test.ts)
//
// Why per-line, then sum, rather than tax-on-the-summed-subtotal: this is
// the standard invoicing convention (each line is its own taxable supply)
// and it is the only order consistent with 20260806000052_estimates.sql's
// documented per-line discount contract -- that migration only defines
// rounding at the line level, so extending "round once more, per tax type,
// per line" is the natural continuation of the same contract rather than a
// second, invoice-level rounding rule invented here. It is also the
// classic case where per-line rounding and rounding-the-total can disagree
// by a cent on a multi-line invoice -- engine.test.ts has a dedicated test
// with a hand-verified example asserting this module's chosen order, so a
// future change to that order fails a test rather than silently drifting.
//
// ============================================================================
// QUANTITY / MONEY REPRESENTATION
// ============================================================================
//
// - Money: integer cents as BigInt, exclusively via lib/money/cents.ts's
//   primitives (roundFractionToCents, multiplyCentsByFraction). No
//   Number()/parseFloat/toFixed/Intl.NumberFormat anywhere in this module.
// - Quantity: a decimal string (matching the `numeric` Postgres column type
//   quantity comes from), parsed by lib/money/cents.ts's
//   parseDecimalQuantity into an exact BigInt numerator/denominator pair.
//   Multiplying that against unitPriceCents and rounding once via
//   roundFractionToCents is the only place a fractional quantity ever
//   touches an actual cents value -- there is no intermediate float
//   representation at any point.
// - Discount percent and tax rate percent are handled the same way: parsed
//   into an exact fraction (discountPercent as parseDecimalQuantity(...)/100,
//   tax rates as a fixed rateBasisPoints/10_000 constant in rates.ts) and
//   applied via the same roundFractionToCents primitive.
//
// ============================================================================
// UNKNOWN STATUS / OUT-OF-SCOPE PROVINCE -- REVIEW_REQUIRED
// ============================================================================
//
// calculateTax() returns a TaxCalculationResult discriminated union
// (lib/tax/types.ts), never a bare numeric total. A caller MUST narrow on
// `result.status` before it can read any monetary field -- there is no
// field named `totalCents` on the `'review_required'` variant, so
// TypeScript itself blocks the "accidentally treat an unknown case as a
// normal success" mistake this task calls out, on top of the runtime check.
// Triggers, checked before any per-line math runs:
//   - `provinceCode` is not one of AB/ON/BC -> reason 'unsupported_province'
//   - `gstHstStatus === 'unknown'` -> reason 'unknown_gst_hst_status'
//   - province is BC and `bcPstStatus === 'unknown'` -> reason
//     'unknown_bc_pst_status' (checked independently of gstHstStatus -- a BC
//     org can have a perfectly resolved GST status and a still-unknown PST
//     status, or vice versa; either one being unknown alone forces review)
// An 'unregistered' status is NOT an error and never triggers review -- it
// is a real, common, legal case (a small supplier below the CRA
// small-supplier threshold) and simply means 0 tax of that type is charged.

import {
  multiplyCentsByFraction,
  parseDecimalQuantity,
  roundFractionToCents,
  type DecimalFraction,
} from '@/lib/money/cents';
import { BC_PST_RATE, GST_HST_RATES, RATE_DENOMINATOR, isSupportedProvinceCode } from './rates';
import type {
  OrgTaxContext,
  SupportedProvinceCode,
  TaxCalculationOk,
  TaxCalculationResult,
  TaxLineItemBreakdown,
  TaxLineItemInput,
} from './types';

const PERCENT_DENOMINATOR = 100n;

function computeLineDiscountCents(lineSubtotalCents: bigint, input: TaxLineItemInput): bigint {
  if (input.discountPercent != null && input.discountFixedCents != null) {
    throw new TypeError(
      'A line item may not set both discountPercent and discountFixedCents (matches the DB CHECK constraint on estimate_line_items/invoice_line_items).'
    );
  }

  if (input.discountPercent != null) {
    const percentValue = parseDecimalQuantity(input.discountPercent);
    if (!percentValue) {
      throw new TypeError(`Invalid discountPercent: ${JSON.stringify(input.discountPercent)}.`);
    }
    if (percentValue.numerator > percentValue.denominator * 100n) {
      throw new TypeError(`discountPercent must be between 0 and 100, got ${input.discountPercent}.`);
    }
    // percentValue represents the percent itself (e.g. "12.5" -> 125/10);
    // dividing by a further 100 turns it into the "percent / 100" fraction
    // the discount application actually needs.
    const fraction: DecimalFraction = {
      numerator: percentValue.numerator,
      denominator: percentValue.denominator * PERCENT_DENOMINATOR,
    };
    return multiplyCentsByFraction(lineSubtotalCents, fraction);
  }

  if (input.discountFixedCents != null) {
    if (input.discountFixedCents < 0n) {
      throw new TypeError(`discountFixedCents must not be negative, got ${input.discountFixedCents.toString()}.`);
    }
    return input.discountFixedCents < lineSubtotalCents ? input.discountFixedCents : lineSubtotalCents;
  }

  return 0n;
}

function computeLineSubtotalCents(input: TaxLineItemInput): bigint {
  if (input.unitPriceCents < 0n) {
    throw new TypeError(`unitPriceCents must not be negative, got ${input.unitPriceCents.toString()}.`);
  }
  const quantity = parseDecimalQuantity(input.quantity);
  if (!quantity) {
    throw new TypeError(`Invalid quantity string: ${JSON.stringify(input.quantity)}.`);
  }
  if (quantity.numerator <= 0n) {
    throw new TypeError(`quantity must be greater than 0, got ${input.quantity}.`);
  }
  return multiplyCentsByFraction(input.unitPriceCents, quantity);
}

/**
 * Computes the full per-line and invoice/estimate-level tax breakdown for a
 * set of line items, given a province and the org's GST/HST + BC PST
 * registration facts. See this file's header comment for the exact,
 * documented rounding order. Returns a discriminated union -- callers must
 * check `result.status` before reading any monetary field; see the header
 * comment's "UNKNOWN STATUS / OUT-OF-SCOPE PROVINCE" section for exactly
 * when `'review_required'` is returned instead of `'ok'`.
 *
 * Malformed line-item input (negative price, non-positive quantity, both
 * discount fields set, an unparseable quantity/percent string) throws a
 * `TypeError` synchronously -- these represent a caller bug (violating
 * invariants the DB's own CHECK constraints already enforce upstream), not
 * a legitimate-but-uncertain tax situation, so they are NOT folded into the
 * `'review_required'` result variant.
 */
export function calculateTax(
  lineItems: readonly TaxLineItemInput[],
  context: OrgTaxContext
): TaxCalculationResult {
  const { provinceCode } = context;

  if (!isSupportedProvinceCode(provinceCode)) {
    return {
      status: 'review_required',
      reason: 'unsupported_province',
      message: `Province code "${provinceCode}" is outside AB/ON/BC launch scope; tax treatment needs human review.`,
      provinceCode,
    };
  }

  if (context.gstHstStatus === 'unknown') {
    return {
      status: 'review_required',
      reason: 'unknown_gst_hst_status',
      message: `GST/HST registration status is unknown for this org in ${provinceCode}; cannot determine whether to charge GST/HST without human review.`,
      provinceCode,
    };
  }

  if (provinceCode === 'BC' && context.bcPstStatus === 'unknown') {
    return {
      status: 'review_required',
      reason: 'unknown_bc_pst_status',
      message: 'BC PST registration status is unknown for this org; cannot determine whether to charge PST without human review.',
      provinceCode,
    };
  }

  const breakdowns = lineItems.map((input) => computeLineItemBreakdown(input, provinceCode, context));

  return summarize(provinceCode, breakdowns);
}

function computeLineItemBreakdown(
  input: TaxLineItemInput,
  provinceCode: SupportedProvinceCode,
  context: OrgTaxContext
): TaxLineItemBreakdown {
  const lineSubtotalCents = computeLineSubtotalCents(input);
  const lineDiscountCents = computeLineDiscountCents(lineSubtotalCents, input);
  const lineNetCents = lineSubtotalCents - lineDiscountCents;

  const gstHstRate = GST_HST_RATES[provinceCode];
  const gstHstCents =
    context.gstHstStatus === 'registered'
      ? roundFractionToCents(lineNetCents * gstHstRate.rateBasisPoints, RATE_DENOMINATOR)
      : 0n;

  const pstCents =
    provinceCode === 'BC' && context.bcPstStatus === 'registered'
      ? roundFractionToCents(lineNetCents * BC_PST_RATE.rateBasisPoints, RATE_DENOMINATOR)
      : 0n;

  const lineTotalCents = lineNetCents + gstHstCents + pstCents;

  return {
    id: input.id,
    description: input.description,
    quantity: input.quantity,
    unitPriceCents: input.unitPriceCents,
    lineSubtotalCents,
    lineDiscountCents,
    lineNetCents,
    gstHstCents,
    pstCents,
    lineTotalCents,
  };
}

function summarize(
  provinceCode: SupportedProvinceCode,
  lineItems: readonly TaxLineItemBreakdown[]
): TaxCalculationOk {
  let subtotalCents = 0n;
  let discountTotalCents = 0n;
  let gstHstTotalCents = 0n;
  let pstTotalCents = 0n;

  for (const line of lineItems) {
    subtotalCents += line.lineSubtotalCents;
    discountTotalCents += line.lineDiscountCents;
    gstHstTotalCents += line.gstHstCents;
    pstTotalCents += line.pstCents;
  }

  const taxTotalCents = gstHstTotalCents + pstTotalCents;
  const totalCents = subtotalCents - discountTotalCents + taxTotalCents;

  return {
    status: 'ok',
    provinceCode,
    lineItems,
    subtotalCents,
    discountTotalCents,
    gstHstTotalCents,
    pstTotalCents,
    taxTotalCents,
    totalCents,
  };
}
