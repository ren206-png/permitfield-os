// Gate 4 (Quotes & Payments), Phase A: AB/ON/BC sales-tax + line-item
// totaling domain module -- type definitions.
//
// Framework-free, DB-free. Mirrors the shapes already established by
// supabase/migrations/20260806000051_org_tax_profiles.sql (tax_registration_status,
// the independent gst_hst_status/bc_pst_status pair) and
// 20260806000052_estimates.sql / 20260806000054_invoices.sql (quantity as a
// decimal string, unit_price_cents as bigint, the mutually-exclusive
// discount_percent/discount_fixed_cents pair) -- this module consumes those
// exact shapes rather than inventing parallel ones, so a future service
// layer can pass a DB row's fields straight in with minimal translation.

/**
 * Mirrors `tax_registration_status` (20260806000051_org_tax_profiles.sql).
 * `'unknown'` is a real, legitimate value -- not an error state -- and must
 * be handled distinctly from both `'registered'` and `'unregistered'` (see
 * engine.ts's header comment and `TaxCalculationReviewRequired` below).
 */
export type TaxRegistrationStatus = 'unregistered' | 'registered' | 'unknown';

/** Provinces in scope for launch (GATE_4_FINDINGS.md §8 assumption 2, §I item 7). */
export type SupportedProvinceCode = 'AB' | 'ON' | 'BC';

/**
 * The tax registration facts needed to calculate tax for one estimate/
 * invoice. `provinceCode` is deliberately a bare `string`, not
 * `SupportedProvinceCode` -- the whole point of this module is to detect an
 * out-of-scope province at runtime (a caller passing a province code that
 * isn't AB/ON/BC is a normal, expected input, not a type error) and signal
 * `REVIEW_REQUIRED` rather than have TypeScript narrow the problem away.
 *
 * `bcPstStatus` is present unconditionally (mirroring `org_tax_profiles`,
 * which always carries both status columns regardless of the org's
 * province) but is only ever consulted when `provinceCode === 'BC'` -- GST/
 * HST and BC PST are tracked as two entirely independent facts on purpose
 * (GATE_4_FINDINGS.md §I item 7 / the master prompt's "never infer one from
 * the other" rule) and this type keeps that independence explicit rather
 * than collapsing it into one "registered" flag.
 */
export interface OrgTaxContext {
  provinceCode: string;
  gstHstStatus: TaxRegistrationStatus;
  bcPstStatus: TaxRegistrationStatus;
}

/**
 * One line item's input. Mirrors `estimate_line_items`/`invoice_line_items`
 * column shapes exactly:
 * - `quantity` is a decimal string (matching the `numeric` column type),
 *   never a `number` -- see lib/money/cents.ts's `parseDecimalQuantity` for
 *   why, and engine.ts's header comment for the full rounding-order policy.
 * - `unitPriceCents` is a `bigint`, following this codebase's global
 *   float-free money discipline.
 * - `discountPercent` and `discountFixedCents` are mutually exclusive (at
 *   most one may be set), matching the CHECK constraint on both line-item
 *   tables. `discountPercent` is also a decimal string (e.g. "12.5" for
 *   12.5%), not a `number`, for the identical exact-arithmetic reason as
 *   `quantity`.
 */
export interface TaxLineItemInput {
  /** Caller-supplied identifier for traceability in the output; not validated. */
  id?: string;
  description: string;
  quantity: string;
  unitPriceCents: bigint;
  discountPercent?: string | null;
  discountFixedCents?: bigint | null;
}

/** One line item's fully computed breakdown -- see engine.ts for the exact order these fields are derived in. */
export interface TaxLineItemBreakdown {
  id: string | undefined;
  description: string;
  quantity: string;
  unitPriceCents: bigint;
  /** round(quantity * unitPriceCents), before any discount. */
  lineSubtotalCents: bigint;
  /** Amount subtracted for this line's discount (0n if none configured). */
  lineDiscountCents: bigint;
  /** lineSubtotalCents - lineDiscountCents -- the taxable base for this line. */
  lineNetCents: bigint;
  /** GST or HST charged on this line (0n if unregistered; never populated for an unknown/review-required calculation). */
  gstHstCents: bigint;
  /** BC PST charged on this line (0n outside BC, or if unregistered). */
  pstCents: bigint;
  /** lineNetCents + gstHstCents + pstCents. */
  lineTotalCents: bigint;
}

/** A fully successful calculation -- safe for a caller to treat as final numbers. */
export interface TaxCalculationOk {
  status: 'ok';
  provinceCode: SupportedProvinceCode;
  lineItems: readonly TaxLineItemBreakdown[];
  /** Sum of every line's lineSubtotalCents (pre-discount, pre-tax). */
  subtotalCents: bigint;
  /** Sum of every line's lineDiscountCents. */
  discountTotalCents: bigint;
  /** Sum of every line's gstHstCents. */
  gstHstTotalCents: bigint;
  /** Sum of every line's pstCents (always 0n outside BC). */
  pstTotalCents: bigint;
  /** gstHstTotalCents + pstTotalCents. */
  taxTotalCents: bigint;
  /** subtotalCents - discountTotalCents + taxTotalCents (== sum of every line's lineTotalCents). */
  totalCents: bigint;
}

/**
 * The `REVIEW_REQUIRED` signal (GATE_4_FINDINGS.md §9 risk 5 / the master
 * prompt §5's instruction that mixed/ambiguous/unsupported tax cases must
 * never silently resolve to a number). Structurally distinct from
 * `TaxCalculationOk` (no `totalCents`/`taxTotalCents` field exists on this
 * variant at all) so a caller cannot accidentally read a dollar amount off
 * a review-required result -- TypeScript's discriminated-union narrowing on
 * `status` is required to reach any monetary field.
 */
export interface TaxCalculationReviewRequired {
  status: 'review_required';
  reason: TaxReviewReason;
  /** Human-readable detail for logging/support tooling. */
  message: string;
  /** Echoes the input province code verbatim, even if it's not a supported one. */
  provinceCode: string;
}

export type TaxReviewReason =
  | 'unsupported_province'
  | 'unknown_gst_hst_status'
  | 'unknown_bc_pst_status';

export type TaxCalculationResult = TaxCalculationOk | TaxCalculationReviewRequired;
