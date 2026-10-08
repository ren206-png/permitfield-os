import { describe, expect, it } from 'vitest';
import { parseRequirementEdit, reviewCounts, reviewStatus } from './review';

const now = new Date('2026-10-08T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('reviewStatus()', () => {
  it('is pending until verified, verified when checked recently, stale after 180 days', () => {
    expect(reviewStatus({ verification_status: 'pending_review', verified_at: null, archived_at: null }, now)).toBe('pending');
    expect(reviewStatus({ verification_status: 'verified', verified_at: daysAgo(10), archived_at: null }, now)).toBe('verified');
    expect(reviewStatus({ verification_status: 'verified', verified_at: daysAgo(181), archived_at: null }, now)).toBe('stale');
  });

  it('treats retired as retired whatever its verification', () => {
    expect(reviewStatus({ verification_status: 'verified', verified_at: daysAgo(1), archived_at: daysAgo(0) }, now)).toBe('retired');
  });
});

describe('reviewCounts()', () => {
  it('counts each status and the total', () => {
    const counts = reviewCounts(
      [
        { verification_status: 'pending_review', verified_at: null, archived_at: null },
        { verification_status: 'verified', verified_at: daysAgo(1), archived_at: null },
        { verification_status: 'verified', verified_at: daysAgo(400), archived_at: null },
        { verification_status: 'pending_review', verified_at: null, archived_at: daysAgo(2) },
      ],
      now
    );
    expect(counts).toEqual({ verified: 1, stale: 1, pending: 1, retired: 1, total: 4 });
  });
});

describe('parseRequirementEdit()', () => {
  it('trims, collapses whitespace, and turns blanks into null', () => {
    expect(parseRequirementEdit({ title: '  Site   plan ', description: '  ', appliesWhen: '\n' })).toEqual({
      title: 'Site plan',
      description: null,
      appliesWhen: null,
    });
  });

  it('requires a title and caps lengths', () => {
    expect(parseRequirementEdit({ title: ' ', description: 'x', appliesWhen: '' })).toEqual({ error: 'The requirement needs a title.' });
    expect(parseRequirementEdit({ title: 'x'.repeat(201), description: '', appliesWhen: '' })).toHaveProperty('error');
    expect(parseRequirementEdit({ title: 'ok', description: 'x'.repeat(1001), appliesWhen: '' })).toHaveProperty('error');
  });

  it('rejects non-string input as blank', () => {
    expect(parseRequirementEdit({ title: null, description: undefined, appliesWhen: 3 })).toEqual({ error: 'The requirement needs a title.' });
  });
});
