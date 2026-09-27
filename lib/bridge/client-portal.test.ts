import { describe, it, expect } from 'vitest';
import { evaluateIpRateLimit, lifecycleActorColumns } from './client-portal';

// GATE_5_FINDINGS.md §A.4 follow-up. Pure-function tests, no network/DB --
// same discipline as lib/ai/cost-caps.test.ts's evaluateCostCap() tests,
// for an identical shape of problem (a count compared against a cap). Only
// evaluateIpRateLimit() is exercised here; countRecentDeniedAttemptsForIp()
// is a thin DB-touching wrapper around it and is not unit-tested, same
// "pure core tested, thin DB wrapper not" split cost-caps.ts's own header
// comment describes.

describe('evaluateIpRateLimit()', () => {
  it('allows the attempt when recent denied attempts are below the max', () => {
    expect(evaluateIpRateLimit(0, 20)).toBe(true);
    expect(evaluateIpRateLimit(19, 20)).toBe(true);
  });

  // Deliberately strict `<`, not `<=` -- same reasoning evaluateCostCap's
  // own header comment gives: once the count already equals the max, the
  // *next* attempt is the one that would push over it, so that next
  // attempt is the one this function must reject.
  it('rejects the attempt once recent denied attempts equal the max', () => {
    expect(evaluateIpRateLimit(20, 20)).toBe(false);
  });

  it('rejects the attempt once recent denied attempts exceed the max', () => {
    expect(evaluateIpRateLimit(21, 20)).toBe(false);
  });

  it('rejects a negative recentDeniedAttempts rather than silently treating it as zero', () => {
    expect(() => evaluateIpRateLimit(-1, 20)).toThrow(/nonnegative/);
  });
});

// issueTargetToken()'s token_lifecycle_events actor columns. Each result must
// satisfy that table's CHECK constraint,
// `(triggered_by_org_user_id is not null) <> triggered_by_system` -- exactly
// one actor, never both, never neither.
describe('lifecycleActorColumns()', () => {
  it('attributes a staff-issued token to the org member', () => {
    expect(lifecycleActorColumns({ issuedByOrgUserId: 'user-1' })).toEqual({
      triggered_by_org_user_id: 'user-1',
      triggered_by_system: false,
    });
  });

  it('attributes a system-issued token to the system, with no org member', () => {
    expect(lifecycleActorColumns({ issuedBySystem: true })).toEqual({
      triggered_by_org_user_id: null,
      triggered_by_system: true,
    });
  });
});
