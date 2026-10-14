import { describe, it, expect } from 'vitest';
import { formatCad, foundingPriceCents, foundingRank, FOUNDING_CUSTOMER_LIMIT } from './founding';

describe('foundingPriceCents()', () => {
  it('takes 25% off, rounded to the dollar', () => {
    expect(formatCad(foundingPriceCents(14900))).toBe('CA$112');
    expect(formatCad(foundingPriceCents(49900))).toBe('CA$374');
    expect(formatCad(foundingPriceCents(7900))).toBe('CA$59');
  });
});

describe('foundingRank()', () => {
  const ours = { id: 'renco' };
  const customers = Array.from({ length: FOUNDING_CUSTOMER_LIMIT + 2 }, (_, i) => ({ id: `c${i + 1}` }));
  const orgs = [ours, ...customers];
  const internal = new Set(['renco']);

  it('ranks customer organizations oldest first, skipping our own', () => {
    expect(foundingRank(orgs, internal, 'c1')).toBe(1);
    expect(foundingRank(orgs, internal, `c${FOUNDING_CUSTOMER_LIMIT}`)).toBe(FOUNDING_CUSTOMER_LIMIT);
  });

  it('gives no place past the limit, to our own orgs, or to unknown ids', () => {
    expect(foundingRank(orgs, internal, `c${FOUNDING_CUSTOMER_LIMIT + 1}`)).toBeNull();
    expect(foundingRank(orgs, internal, 'renco')).toBeNull();
    expect(foundingRank(orgs, internal, 'nope')).toBeNull();
  });
});
