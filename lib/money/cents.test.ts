import { describe, expect, it } from 'vitest';
import { multiplyCentsByFraction, parseDecimalQuantity, roundFractionToCents } from './cents';

// Gate 4 (Quotes & Payments) addition. Covers the three new BigInt-only
// primitives lib/tax/engine.ts relies on for exact fractional-quantity and
// percentage-rate arithmetic. See cents.ts's own header comments for the
// float-free discipline these enforce.

describe('parseDecimalQuantity', () => {
  it('parses a whole number', () => {
    expect(parseDecimalQuantity('3')).toEqual({ numerator: 3n, denominator: 1n });
  });

  it('parses a decimal with one fractional digit', () => {
    expect(parseDecimalQuantity('2.5')).toEqual({ numerator: 25n, denominator: 10n });
  });

  it('parses a decimal with two fractional digits', () => {
    expect(parseDecimalQuantity('12.75')).toEqual({ numerator: 1275n, denominator: 100n });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDecimalQuantity('  3.0  ')).toEqual({ numerator: 30n, denominator: 10n });
  });

  it('returns null for an unparseable string', () => {
    expect(parseDecimalQuantity('abc')).toBeNull();
    expect(parseDecimalQuantity('')).toBeNull();
    expect(parseDecimalQuantity('-1')).toBeNull();
    expect(parseDecimalQuantity('1.2.3')).toBeNull();
  });
});

describe('roundFractionToCents (round-half-up)', () => {
  it('rounds down when below the half-cent boundary', () => {
    expect(roundFractionToCents(83324n, 10n)).toBe(8332n); // 8332.4
  });

  it('rounds up on an exact tie (half-away-from-zero, never banker\'s rounding)', () => {
    expect(roundFractionToCents(83325n, 10n)).toBe(8333n); // 8332.5 -> 8333
  });

  it('rounds up when above the half-cent boundary', () => {
    expect(roundFractionToCents(83326n, 10n)).toBe(8333n); // 8332.6
  });

  it('returns an exact whole-number result unchanged', () => {
    expect(roundFractionToCents(21000n, 1n)).toBe(21000n);
  });

  it('throws for a non-positive denominator', () => {
    expect(() => roundFractionToCents(1n, 0n)).toThrow();
    expect(() => roundFractionToCents(1n, -1n)).toThrow();
  });

  it('throws for a negative numerator', () => {
    expect(() => roundFractionToCents(-1n, 1n)).toThrow();
  });
});

describe('multiplyCentsByFraction', () => {
  it('multiplies exact-quantity cases with no rounding needed', () => {
    // 2.5 hours at $100.00/hour = 25,000 cents exactly.
    expect(multiplyCentsByFraction(10_000n, { numerator: 25n, denominator: 10n })).toBe(25_000n);
  });

  it('multiplies and rounds a half-cent case up', () => {
    // 2.5 hours at $33.33/hour: 2.5 * 3333 = 8332.5 -> 8333.
    expect(multiplyCentsByFraction(3_333n, { numerator: 25n, denominator: 10n })).toBe(8_333n);
  });

  it('throws for negative cents', () => {
    expect(() => multiplyCentsByFraction(-1n, { numerator: 1n, denominator: 1n })).toThrow();
  });
});
