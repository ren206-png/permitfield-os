import { describe, expect, it } from 'vitest';
import { calculateTax } from './engine';
import type { OrgTaxContext, TaxCalculationOk, TaxLineItemInput } from './types';

// Gate 4 (Quotes & Payments), Phase A. See engine.ts's header comment for
// the exact rounding-order contract every assertion below is pinned to.
// No vitest test file in this codebase mocks Supabase (lib/entitlements/index.test.ts's
// own header) -- this module needs no such mock at all, since it is
// framework-free and DB-free by construction.

function ctx(overrides: Partial<OrgTaxContext>): OrgTaxContext {
  return {
    provinceCode: 'AB',
    gstHstStatus: 'registered',
    bcPstStatus: 'unregistered',
    ...overrides,
  };
}

function line(overrides: Partial<TaxLineItemInput>): TaxLineItemInput {
  return {
    description: 'Line item',
    quantity: '1',
    unitPriceCents: 10_000n,
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof calculateTax>): TaxCalculationOk {
  if (result.status !== 'ok') {
    throw new Error(`Expected an 'ok' result, got '${result.status}' (${JSON.stringify(result)}).`);
  }
  return result;
}

describe('calculateTax -- AB (GST only, no PST)', () => {
  it('charges 5% GST and no PST for a registered org', () => {
    // $100.00 line, AB GST 5.00% (migration 20260806000055 row 1, UNVERIFIED
    // fixture): 10_000 * 500 / 10_000 = 500 cents GST.
    const result = expectOk(
      calculateTax([line({ unitPriceCents: 10_000n })], ctx({ provinceCode: 'AB', gstHstStatus: 'registered' }))
    );
    expect(result.subtotalCents).toBe(10_000n);
    expect(result.gstHstTotalCents).toBe(500n);
    expect(result.pstTotalCents).toBe(0n);
    expect(result.taxTotalCents).toBe(500n);
    expect(result.totalCents).toBe(10_500n);
    expect(result.lineItems[0].pstCents).toBe(0n);
  });
});

describe('calculateTax -- ON (HST, single combined rate)', () => {
  it('charges 13% HST for a registered org, none for unregistered', () => {
    // $200.00 line, ON HST 13.00%: 20_000 * 1300 / 10_000 = 2_600 cents.
    const registered = expectOk(
      calculateTax([line({ unitPriceCents: 20_000n })], ctx({ provinceCode: 'ON', gstHstStatus: 'registered' }))
    );
    expect(registered.gstHstTotalCents).toBe(2_600n);
    expect(registered.totalCents).toBe(22_600n);

    const unregistered = expectOk(
      calculateTax([line({ unitPriceCents: 20_000n })], ctx({ provinceCode: 'ON', gstHstStatus: 'unregistered' }))
    );
    expect(unregistered.gstHstTotalCents).toBe(0n);
    expect(unregistered.totalCents).toBe(20_000n);
  });
});

describe('calculateTax -- BC (GST + independent PST)', () => {
  const bcLine = [line({ unitPriceCents: 100_000n })]; // $1,000.00

  it('both registered: GST (5%) and PST (7%) are each applied independently', () => {
    const result = expectOk(
      calculateTax(bcLine, ctx({ provinceCode: 'BC', gstHstStatus: 'registered', bcPstStatus: 'registered' }))
    );
    expect(result.gstHstTotalCents).toBe(5_000n); // 100_000 * 500 / 10_000
    expect(result.pstTotalCents).toBe(7_000n); // 100_000 * 700 / 10_000
    expect(result.taxTotalCents).toBe(12_000n);
    expect(result.totalCents).toBe(112_000n);
  });

  it('GST registered, PST unregistered: only GST charged', () => {
    const result = expectOk(
      calculateTax(bcLine, ctx({ provinceCode: 'BC', gstHstStatus: 'registered', bcPstStatus: 'unregistered' }))
    );
    expect(result.gstHstTotalCents).toBe(5_000n);
    expect(result.pstTotalCents).toBe(0n);
    expect(result.totalCents).toBe(105_000n);
  });

  it('GST unregistered, PST registered: only PST charged (never inferred from GST status)', () => {
    const result = expectOk(
      calculateTax(bcLine, ctx({ provinceCode: 'BC', gstHstStatus: 'unregistered', bcPstStatus: 'registered' }))
    );
    expect(result.gstHstTotalCents).toBe(0n);
    expect(result.pstTotalCents).toBe(7_000n);
    expect(result.totalCents).toBe(107_000n);
  });

  it('both unregistered: no tax at all, not an error', () => {
    const result = expectOk(
      calculateTax(bcLine, ctx({ provinceCode: 'BC', gstHstStatus: 'unregistered', bcPstStatus: 'unregistered' }))
    );
    expect(result.gstHstTotalCents).toBe(0n);
    expect(result.pstTotalCents).toBe(0n);
    expect(result.taxTotalCents).toBe(0n);
    expect(result.totalCents).toBe(100_000n);
  });
});

describe('calculateTax -- unregistered GST/HST is a legal non-error case', () => {
  it('charges zero GST for an AB org below the small-supplier threshold', () => {
    const result = expectOk(
      calculateTax([line({ unitPriceCents: 5_000n })], ctx({ provinceCode: 'AB', gstHstStatus: 'unregistered' }))
    );
    expect(result.status).toBe('ok');
    expect(result.gstHstTotalCents).toBe(0n);
    expect(result.totalCents).toBe(5_000n);
  });
});

describe('calculateTax -- unknown registration status signals REVIEW_REQUIRED, never a silent number', () => {
  it('returns review_required (not ok) when GST/HST status is unknown', () => {
    const result = calculateTax([line({})], ctx({ provinceCode: 'AB', gstHstStatus: 'unknown' }));
    expect(result.status).toBe('review_required');
    if (result.status !== 'review_required') throw new Error('unreachable');
    expect(result.reason).toBe('unknown_gst_hst_status');
    // Structural guarantee: no totalCents field exists on this variant at all.
    expect('totalCents' in result).toBe(false);
  });

  it('returns review_required when BC PST status is unknown, even if GST/HST status is known', () => {
    const result = calculateTax(
      [line({})],
      ctx({ provinceCode: 'BC', gstHstStatus: 'registered', bcPstStatus: 'unknown' })
    );
    expect(result.status).toBe('review_required');
    if (result.status !== 'review_required') throw new Error('unreachable');
    expect(result.reason).toBe('unknown_bc_pst_status');
  });

  it('an unknown BC PST status is irrelevant outside BC (AB has no PST) -- only gstHstStatus matters there', () => {
    const result = expectOk(
      calculateTax([line({})], ctx({ provinceCode: 'AB', gstHstStatus: 'registered', bcPstStatus: 'unknown' }))
    );
    expect(result.status).toBe('ok');
  });
});

describe('calculateTax -- out-of-scope province signals REVIEW_REQUIRED, never a silent wrong number', () => {
  it('returns review_required for a province outside AB/ON/BC', () => {
    const result = calculateTax([line({})], ctx({ provinceCode: 'QC', gstHstStatus: 'registered' }));
    expect(result.status).toBe('review_required');
    if (result.status !== 'review_required') throw new Error('unreachable');
    expect(result.reason).toBe('unsupported_province');
    expect(result.provinceCode).toBe('QC');
  });

  it('returns review_required for a garbage/empty province code', () => {
    const result = calculateTax([line({})], ctx({ provinceCode: '' }));
    expect(result.status).toBe('review_required');
  });
});

describe('calculateTax -- fractional quantities use exact decimal arithmetic', () => {
  it('2.5 hours at $33.33/hour rounds the exact half-cent up (hand-verified)', () => {
    // 2.5 * 3333 = 8332.5 cents exactly -- round-half-up takes this to 8333,
    // never routing through a binary float that could land on 8332 or 8334.
    const result = expectOk(
      calculateTax(
        [line({ quantity: '2.5', unitPriceCents: 3_333n })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'unregistered' })
      )
    );
    expect(result.lineItems[0].lineSubtotalCents).toBe(8_333n);
    expect(result.subtotalCents).toBe(8_333n);
  });

  it('2.5 hours at $100.00/hour (exact, no rounding needed) totals correctly with GST', () => {
    // 2.5 * 10_000 = 25_000 cents exactly; GST 5% of 25_000 = 1_250 cents.
    const result = expectOk(
      calculateTax(
        [line({ quantity: '2.5', unitPriceCents: 10_000n })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'registered' })
      )
    );
    expect(result.lineItems[0].lineSubtotalCents).toBe(25_000n);
    expect(result.gstHstTotalCents).toBe(1_250n);
    expect(result.totalCents).toBe(26_250n);
  });

  it('12.75 linear feet at $4.20/ft', () => {
    // 12.75 * 420 = 5,355 cents exactly.
    const result = expectOk(
      calculateTax(
        [line({ quantity: '12.75', unitPriceCents: 420n })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'unregistered' })
      )
    );
    expect(result.lineItems[0].lineSubtotalCents).toBe(5_355n);
  });
});

describe('calculateTax -- multi-line rounding order (per-line tax, summed) vs. tax-on-the-total', () => {
  it('sums each line’s independently-rounded tax rather than rounding the summed subtotal once', () => {
    // ON HST 13.00%. Three lines: 50c, 50c, 1c (subtotal 101c).
    //   Per-line tax:  round(50 * 0.13) = round(6.5)  = 7
    //                  round(50 * 0.13) = round(6.5)  = 7
    //                  round(1  * 0.13) = round(0.13) = 0
    //                  sum = 14
    //   Tax on the summed subtotal instead would be: round(101 * 0.13) =
    //     round(13.13) = 13 -- ONE CENT LOWER than this module's chosen order.
    // This assertion is pinned to 14/115, not 13/114, so a future change
    // that silently switches the rounding order fails this test.
    const result = expectOk(
      calculateTax(
        [
          line({ description: 'A', unitPriceCents: 50n }),
          line({ description: 'B', unitPriceCents: 50n }),
          line({ description: 'C', unitPriceCents: 1n }),
        ],
        ctx({ provinceCode: 'ON', gstHstStatus: 'registered' })
      )
    );
    expect(result.subtotalCents).toBe(101n);
    expect(result.lineItems.map((l) => l.gstHstCents)).toEqual([7n, 7n, 0n]);
    expect(result.gstHstTotalCents).toBe(14n);
    expect(result.totalCents).toBe(115n);

    // Internal consistency: totalCents must equal both derivations.
    const sumOfLineTotals = result.lineItems.reduce((acc, l) => acc + l.lineTotalCents, 0n);
    expect(sumOfLineTotals).toBe(result.totalCents);
    expect(result.subtotalCents - result.discountTotalCents + result.taxTotalCents).toBe(result.totalCents);
  });
});

describe('calculateTax -- zero-amount / empty line item list', () => {
  it('returns all-zero totals for an empty line item list, still validating the tax context', () => {
    const result = expectOk(calculateTax([], ctx({ provinceCode: 'AB', gstHstStatus: 'registered' })));
    expect(result.subtotalCents).toBe(0n);
    expect(result.discountTotalCents).toBe(0n);
    expect(result.gstHstTotalCents).toBe(0n);
    expect(result.pstTotalCents).toBe(0n);
    expect(result.taxTotalCents).toBe(0n);
    expect(result.totalCents).toBe(0n);
    expect(result.lineItems).toHaveLength(0);
  });

  it('a zero-price line item (e.g. a comped item) contributes zero everywhere', () => {
    const result = expectOk(
      calculateTax([line({ unitPriceCents: 0n })], ctx({ provinceCode: 'AB', gstHstStatus: 'registered' }))
    );
    expect(result.totalCents).toBe(0n);
  });

  it('an empty line item list on an unsupported province still returns review_required', () => {
    const result = calculateTax([], ctx({ provinceCode: 'QC' }));
    expect(result.status).toBe('review_required');
  });
});

describe('calculateTax -- discounts are applied before tax, not after (legal/correctness distinction)', () => {
  it('a percent discount reduces the taxable base before GST is computed', () => {
    // $100.00 line, 10% discount -> $10.00 off -> $90.00 taxable base.
    // GST 5% of $90.00 = $4.50 = 450 cents. If tax were (incorrectly)
    // computed on the pre-discount $100.00, it would be 500 cents instead --
    // this assertion is pinned to 450, not 500.
    const result = expectOk(
      calculateTax(
        [line({ unitPriceCents: 10_000n, discountPercent: '10' })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'registered' })
      )
    );
    const l = result.lineItems[0];
    expect(l.lineSubtotalCents).toBe(10_000n);
    expect(l.lineDiscountCents).toBe(1_000n);
    expect(l.lineNetCents).toBe(9_000n);
    expect(l.gstHstCents).toBe(450n); // NOT 500n
    expect(l.lineTotalCents).toBe(9_450n);
    expect(result.totalCents).toBe(9_450n);
    expect(result.discountTotalCents).toBe(1_000n);
  });

  it('a fixed-cents discount larger than the line is capped at the line subtotal, never negative', () => {
    const result = expectOk(
      calculateTax(
        [line({ unitPriceCents: 500n, discountFixedCents: 700n })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'registered' })
      )
    );
    const l = result.lineItems[0];
    expect(l.lineDiscountCents).toBe(500n);
    expect(l.lineNetCents).toBe(0n);
    expect(l.gstHstCents).toBe(0n);
    expect(l.lineTotalCents).toBe(0n);
  });

  it('rejects a line item that sets both discountPercent and discountFixedCents', () => {
    expect(() =>
      calculateTax(
        [line({ discountPercent: '10', discountFixedCents: 100n })],
        ctx({ provinceCode: 'AB', gstHstStatus: 'registered' })
      )
    ).toThrow(TypeError);
  });
});

describe('calculateTax -- malformed line-item input throws (caller bug, not a tax-review case)', () => {
  it('throws for a non-positive quantity', () => {
    expect(() => calculateTax([line({ quantity: '0' })], ctx({}))).toThrow(TypeError);
    expect(() => calculateTax([line({ quantity: '-1' })], ctx({}))).toThrow(TypeError);
  });

  it('throws for a negative unit price', () => {
    expect(() => calculateTax([line({ unitPriceCents: -1n })], ctx({}))).toThrow(TypeError);
  });

  it('throws for an unparseable quantity string', () => {
    expect(() => calculateTax([line({ quantity: 'abc' })], ctx({}))).toThrow(TypeError);
  });

  it('throws for a discountPercent outside 0-100', () => {
    expect(() => calculateTax([line({ discountPercent: '150' })], ctx({}))).toThrow(TypeError);
  });
});
