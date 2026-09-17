// Gate 4 (Quotes & Payments), Phase A: rate table.
//
// Mirrors supabase/migrations/20260806000055_tax_rule_versions_and_decisions.sql's
// seed rows EXACTLY -- same four (province, tax_type, rate_percent) triples,
// same UNVERIFIED status. This file does not "fix" or second-guess those
// rates; it consumes them as fixture data, per this task's explicit
// instruction. If a real rate is later verified against a live CRA/BC
// source, this file's constants (and the migration's seed rows) both need
// updating together -- there is deliberately no runtime DB read here (this
// module is DB-free by design), so keeping the two in sync is a manual,
// documented responsibility of whoever verifies the rates, not something
// this file can enforce for itself.
//
// rate_percent in the migration is a SQL `numeric` (5.00, 13.00, 7.00).
// Represented here as whole "basis points of a percent" (rate_percent * 100)
// over a fixed 10_000n denominator, so that `amountCents * ratePercent / 100`
// becomes the exact integer-only `amountCents * rateBasisPoints / 10_000`
// (see lib/money/cents.ts's roundFractionToCents). E.g. 5.00% -> 500n/10_000n,
// 13.00% -> 1_300n/10_000n, 7.00% -> 700n/10_000n.

import type { SupportedProvinceCode } from './types';

/** Denominator shared by every rate below: rateBasisPoints / RATE_DENOMINATOR == ratePercent / 100. */
export const RATE_DENOMINATOR = 10_000n;

export type GstHstTaxType = 'gst' | 'hst';

interface GstHstRate {
  taxType: GstHstTaxType;
  /** rate_percent * 100 from the migration's seed row. */
  rateBasisPoints: bigint;
  verified: false;
  sourceNote: string;
}

interface PstRate {
  rateBasisPoints: bigint;
  verified: false;
  sourceNote: string;
}

// AB: GST only, no provincial sales tax (migration 000048 row 1).
// ON: HST, single combined rate (migration 000048 row 2).
// BC: GST (row 3) + separate, independently-tracked PST (row 4).
export const GST_HST_RATES: Readonly<Record<SupportedProvinceCode, GstHstRate>> = {
  AB: {
    taxType: 'gst',
    rateBasisPoints: 500n, // 5.00%
    verified: false,
    sourceNote:
      'UNVERIFIED fixture seed -- nominal federal GST rate for Alberta (no provincial sales tax in AB); mirrors 20260806000055 row 1.',
  },
  ON: {
    taxType: 'hst',
    rateBasisPoints: 1_300n, // 13.00%
    verified: false,
    sourceNote:
      'UNVERIFIED fixture seed -- nominal harmonized HST rate for Ontario; mirrors 20260806000055 row 2.',
  },
  BC: {
    taxType: 'gst',
    rateBasisPoints: 500n, // 5.00%
    verified: false,
    sourceNote:
      'UNVERIFIED fixture seed -- nominal federal GST rate for British Columbia; mirrors 20260806000055 row 3.',
  },
};

// Only BC has a provincial sales tax among AB/ON/BC. Deliberately not keyed
// by SupportedProvinceCode (a Record would force an AB/ON entry that
// doesn't exist) -- callers must explicitly check `provinceCode === 'BC'`
// before consulting this, which is exactly the "never infer BC PST from an
// AB/ON code" invariant this module must hold.
export const BC_PST_RATE: PstRate = {
  rateBasisPoints: 700n, // 7.00%
  verified: false,
  sourceNote:
    "UNVERIFIED fixture seed -- nominal BC provincial PST rate, tracked entirely independently of BC's GST row; mirrors 20260806000055 row 4.",
};

export function isSupportedProvinceCode(code: string): code is SupportedProvinceCode {
  return code === 'AB' || code === 'ON' || code === 'BC';
}
