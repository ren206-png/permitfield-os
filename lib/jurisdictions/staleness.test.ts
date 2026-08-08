import { describe, it, expect } from 'vitest';
import {
  computeEffectiveVerificationStatus,
  isStale,
  DEFAULT_STALENESS_THRESHOLD_DAYS,
} from './staleness';

// Lifecycle & Compliance Expansion, Phase 1.2. Pure-function tests, same
// framework-free discipline as lib/authz/index.test.ts and
// lib/entitlements (no DB, no mocks) -- see staleness.ts's header comment
// for why a TypeScript mirror of the SQL function exists at all.

const NOW = new Date('2026-08-07T00:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe('computeEffectiveVerificationStatus', () => {
  it('a verified source well within the threshold stays verified', () => {
    expect(computeEffectiveVerificationStatus('verified', daysAgo(1), 180, NOW)).toBe('verified');
    expect(computeEffectiveVerificationStatus('verified', daysAgo(179), 180, NOW)).toBe('verified');
  });

  it('a verified source exactly at the threshold is NOT yet stale (strict >, matching the SQL function)', () => {
    expect(computeEffectiveVerificationStatus('verified', daysAgo(180), 180, NOW)).toBe('verified');
  });

  it('a verified source older than the threshold computes as stale', () => {
    expect(computeEffectiveVerificationStatus('verified', daysAgo(181), 180, NOW)).toBe('stale');
    expect(computeEffectiveVerificationStatus('verified', daysAgo(400), 180, NOW)).toBe('stale');
  });

  it('DEFAULT_STALENESS_THRESHOLD_DAYS is SS3.3\'s literal 180', () => {
    expect(DEFAULT_STALENESS_THRESHOLD_DAYS).toBe(180);
  });

  it('respects a non-default threshold', () => {
    expect(computeEffectiveVerificationStatus('verified', daysAgo(31), 30, NOW)).toBe('stale');
    expect(computeEffectiveVerificationStatus('verified', daysAgo(29), 30, NOW)).toBe('verified');
  });

  it('accepts an ISO string for verifiedAt, not just a Date', () => {
    const isoOld = daysAgo(181).toISOString();
    const isoRecent = daysAgo(1).toISOString();
    expect(computeEffectiveVerificationStatus('verified', isoOld, 180, NOW)).toBe('stale');
    expect(computeEffectiveVerificationStatus('verified', isoRecent, 180, NOW)).toBe('verified');
  });

  it('non-verified statuses never become stale, regardless of verified_at age', () => {
    const nonVerified = ['unverified', 'pending_review', 'disputed', 'stale'] as const;
    for (const status of nonVerified) {
      expect(computeEffectiveVerificationStatus(status, daysAgo(1000), 180, NOW)).toBe(status);
    }
  });

  it('a verified status with a null verified_at passes through unchanged (cannot compute staleness without a timestamp)', () => {
    expect(computeEffectiveVerificationStatus('verified', null, 180, NOW)).toBe('verified');
  });

  it('defaults `now` to the current wall clock when omitted', () => {
    // Not pinned to NOW here -- this exercises the real default parameter
    // path (no injected `now`) to prove the signature works uncalled-with-4-args,
    // same as any real (non-test) call site will invoke it.
    const result = computeEffectiveVerificationStatus('verified', daysAgo(1));
    expect(result).toBe('verified');
  });
});

describe('isStale', () => {
  it('mirrors computeEffectiveVerificationStatus exactly, as a boolean', () => {
    expect(isStale('verified', daysAgo(181), 180, NOW)).toBe(true);
    expect(isStale('verified', daysAgo(179), 180, NOW)).toBe(false);
    expect(isStale('unverified', daysAgo(1000), 180, NOW)).toBe(false);
    expect(isStale('disputed', daysAgo(1000), 180, NOW)).toBe(false);
  });
});
