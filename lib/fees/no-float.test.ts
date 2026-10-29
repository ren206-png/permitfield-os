import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Gate 6.7, §19 "float money": no floating-point arithmetic on fee values.
// Fee math is BigInt fractions (money.ts); numbers appear only at the edges.
// This scans the fee code for float-style operations and allows exactly the
// reviewed occurrences below -- a new one fails until it is reviewed.

const ALLOWED = new Set([
  // BigInt -> number after a MAX_SAFE_INTEGER check (exact integer).
  'money.ts:  return minor(Number(result));',
  'estimate.ts:    return minor(Number(total));',
  // Display text only (basis points shown as a percent).
  'estimate.ts:    return { ok: true, amount: clamp(raw, c), calculation: `${c.basis_points / 100} % of ${q.text}` };',
  // bigint column read from the database; estimateFees re-checks it is a safe integer.
  'load.ts:  return estimateFees(schedule, { facts, jobValueMinor: typeof jobValue === \'number\' ? jobValue : jobValue ? Number(jobValue) : null, asOf });',
]);
const FLOATY = /parseFloat|toFixed|Math\.(round|floor|ceil|trunc)|Number\(|\* ?0\.\d|\/ ?100\b|\/ ?1000\b/;

describe('fee code has no float arithmetic', () => {
  it('only the reviewed edge conversions use number operations', () => {
    const dir = path.resolve(import.meta.dirname);
    const found: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      for (const line of readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (FLOATY.test(line) && !line.trim().startsWith('//')) found.push(`${file}:${line}`);
      }
    }
    expect(found.filter((f) => !ALLOWED.has(f))).toEqual([]);
    expect(found.length).toBe(ALLOWED.size);
  });
});
