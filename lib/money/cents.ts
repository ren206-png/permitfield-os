// Deterministic, float-free currency-string -> integer-cents conversion.
//
// SS7 adversarial self-check #7 ("the money round-trip"): "$1,250,000.50 ->
// cents -> PDF field -> back. Any float in that path?" The answer this file
// gives is: the model never does currency arithmetic at all. It extracts the
// dollar amount as the raw string exactly as printed on the source document
// (lib/ai/schemas/extraction.ts: `estimated_job_value_raw`), and this
// function -- not the model, not `parseFloat` -- is the single place that
// string becomes an integer-cents value. No `Number()`/`parseFloat` call
// exists anywhere in this file; every step is string slicing and BigInt
// arithmetic.

const CENTS_PATTERN = /^(\d+)(?:\.(\d{0,2}))?$/;

/**
 * Parses a raw currency string (e.g. "$1,250,000.50", "1250000", "CAD
 * 42,000.00") into an exact integer number of cents. Returns null if the
 * string doesn't contain a parseable amount -- callers must treat that as
 * "extraction could not determine a value", never as zero.
 */
export function parseCurrencyToCents(raw: string): bigint | null {
  // Strip currency symbols/codes and whitespace from the front, and thousands
  // separators throughout. Deliberately does not touch the decimal point.
  const cleaned = raw
    .trim()
    .replace(/^[a-zA-Z$]*\s*/, '')
    .replace(/,/g, '')
    .trim();

  const match = CENTS_PATTERN.exec(cleaned);
  if (!match) return null;

  const [, wholePart, fractionPartRaw] = match;
  const fractionPart = (fractionPartRaw ?? '').padEnd(2, '0').slice(0, 2);

  return BigInt(wholePart) * 100n + BigInt(fractionPart);
}

// permit_applications.estimated_job_value_cents is a Postgres `bigint`, but
// JSON (and therefore Supabase's JS client) has no bigint type -- values
// cross that boundary as `number`. Real permit job values are nowhere near
// Number.MAX_SAFE_INTEGER (2^53-1) in cents (~90 trillion dollars), so the
// conversion is safe, but it's guarded rather than silently truncated in the
// one scenario where a corrupt/malicious input could exceed it.
export function centsToSafeNumber(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < 0n) {
    throw new Error(
      `Currency amount ${cents.toString()} cents is outside the safe integer range or negative.`
    );
  }
  return Number(cents);
}

// Phase 4 (lib/pdf/resolve-fields.ts): the reverse direction of
// parseCurrencyToCents, for populating a PDF's dollar-value field from the
// already-computed permit_applications.estimated_job_value_cents. Same
// float-free discipline applies going out as coming in (SS7 adversarial
// check #7 is about the whole round trip, not just one direction) -- no
// `toFixed()`/`toLocaleString()`/`Intl.NumberFormat` call here, every step
// is BigInt arithmetic and string manipulation.
export function centsToDollarsString(cents: bigint): string {
  if (cents < 0n) {
    throw new Error(`Cannot format a negative cents amount (${cents.toString()}) as a dollar string.`);
  }
  const wholeStr = (cents / 100n).toString();
  const fractionStr = (cents % 100n).toString().padStart(2, '0');
  // Thousands separators inserted via regex on the digit string, not a
  // locale-aware formatter -- kept in the same "no floating-point/locale
  // formatting" family as parseCurrencyToCents above.
  const withCommas = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${withCommas}.${fractionStr}`;
}
