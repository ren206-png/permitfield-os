// Gate 4 (Quotes & Payments), Phase A service layer -- shared DB <-> BigInt
// mapping helpers. Isolated in one file so every read/write of a
// `*_cents`/`bigint` column goes through the exact same conversion, rather
// than each service module inventing its own.
//
// Postgres `bigint` columns cross the Supabase JS client boundary as a
// JSON `number` (PostgREST has no JSON bigint type) -- lib/money/cents.ts's
// own header comment documents this exact boundary for
// `estimated_job_value_cents` and provides `centsToSafeNumber()` for the
// BigInt -> number direction (guards against exceeding
// Number.MAX_SAFE_INTEGER). This file adds the read-back direction
// (number/string -> BigInt) that Gate 4 needs and lib/money/cents.ts does
// not provide (that file is explicitly read-only/finished for this task),
// reusing `centsToSafeNumber` for every outbound write rather than a raw
// `Number(cents)` call.
import { centsToSafeNumber } from '@/lib/money/cents';

/** BigInt cents -> a JSON-safe number for a Supabase insert/update payload. Null-safe. */
export function centsToDbValue(cents: bigint): number;
export function centsToDbValue(cents: bigint | null | undefined): number | null;
export function centsToDbValue(cents: bigint | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return centsToSafeNumber(cents);
}

/**
 * A `bigint` column's value as read back from Supabase (a JSON `number`,
 * or occasionally a numeric-looking `string` depending on PostgREST/driver
 * configuration) -> BigInt. Throws on a non-integer or unparseable value
 * rather than silently truncating -- a `*_cents` column that fails this
 * conversion is a data-integrity bug, not a legitimate edge case to paper
 * over.
 */
export function dbValueToCents(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`Expected an integer cents value from the database, got ${value}.`);
    }
    return BigInt(value);
  }
  if (/^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`Expected an integer cents value from the database, got ${JSON.stringify(value)}.`);
}

/** Null-safe variant of dbValueToCents. */
export function dbValueToCentsOrNull(value: number | string | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return dbValueToCents(value);
}
