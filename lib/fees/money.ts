// Gate 6.5: exact money arithmetic for fee estimates (master prompt §16,
// D2). Every amount is an integer number of minor units (cents). Inputs
// that are decimal quantities (118.5 m²) are turned into exact fractions of
// BigInts; nothing is ever multiplied or divided as a float. The only
// rounding is the schedule's own stored rule, applied once per line.

declare const minorUnitsBrand: unique symbol;
export type MinorUnits = number & { readonly [minorUnitsBrand]: true };

export type RoundingRule = 'half_up_to_cent' | 'half_even_to_cent' | 'up_to_dollar' | 'down_to_dollar';

// An exact non-negative rational number of minor units.
export interface Rational {
  num: bigint;
  den: bigint;
}

export function minor(value: number): MinorUnits {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`not a non-negative integer amount of minor units: ${value}`);
  return value as MinorUnits;
}

// "118.5" or 118.5 -> 1185/10, exactly. Accepts at most 6 decimal places;
// anything else (exponents, negatives, NaN) is refused, not approximated.
export function exactDecimal(value: number | string): Rational {
  const text = typeof value === 'number' ? String(value) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error(`not an exact non-negative decimal: ${text}`);
  const decimals = match[2] ?? '';
  return { num: BigInt(match[1] + decimals), den: 10n ** BigInt(decimals.length) };
}

export const mul = (a: Rational, b: Rational): Rational => ({ num: a.num * b.num, den: a.den * b.den });
export const div = (a: Rational, b: Rational): Rational => {
  if (b.num === 0n) throw new Error('division by zero');
  return { num: a.num * b.den, den: a.den * b.num };
};
export const add = (a: Rational, b: Rational): Rational => ({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
export const sub = (a: Rational, b: Rational): Rational => ({ num: a.num * b.den - b.num * a.den, den: a.den * b.den });
export const fromInt = (n: number | bigint): Rational => ({ num: BigInt(n), den: 1n });
export const lessOrEqual = (a: Rational, b: Rational) => a.num * b.den <= b.num * a.den;
export const minR = (a: Rational, b: Rational) => (lessOrEqual(a, b) ? a : b);
export const maxR = (a: Rational, b: Rational) => (lessOrEqual(a, b) ? b : a);

// Rounds an exact amount of minor units to whole minor units by the rule.
export function round(amount: Rational, rule: RoundingRule): MinorUnits {
  if (amount.num < 0n) throw new Error('negative amount');
  const toUnit = (unit: bigint, mode: 'half_up' | 'half_even' | 'up' | 'down'): bigint => {
    const scaledDen = amount.den * unit;
    const q = amount.num / scaledDen;
    const r = amount.num % scaledDen;
    if (r === 0n) return q * unit;
    if (mode === 'up') return (q + 1n) * unit;
    if (mode === 'down') return q * unit;
    const twice = 2n * r;
    if (twice > scaledDen) return (q + 1n) * unit;
    if (twice < scaledDen) return q * unit;
    return (mode === 'half_up' || q % 2n === 1n ? q + 1n : q) * unit;
  };
  const result =
    rule === 'half_up_to_cent'
      ? toUnit(1n, 'half_up')
      : rule === 'half_even_to_cent'
        ? toUnit(1n, 'half_even')
        : rule === 'up_to_dollar'
          ? toUnit(100n, 'up')
          : toUnit(100n, 'down');
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount too large');
  return minor(Number(result));
}

export function formatMinor(amount: MinorUnits, currency: string): string {
  const cents = BigInt(amount);
  const dollars = cents / 100n;
  const rest = String(cents % 100n).padStart(2, '0');
  return `${currency} ${dollars.toLocaleString('en-CA')}.${rest}`;
}
