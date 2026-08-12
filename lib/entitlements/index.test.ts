import { describe, it, expect } from 'vitest';
import { can, limit } from './index';

// Lifecycle & Compliance Expansion, Phase 1.1. lib/entitlements is a
// deliberate stub (see index.ts's header comment: NOT a real billing
// system) -- these tests pin down the one behavior that actually matters
// right now: every org gets the same hardcoded default tier, regardless of
// orgId. When a real per-org tier lookup replaces DEFAULT_TIER, these tests
// are exactly the ones that should start failing (some org should stop
// getting the default), which is the intended signal that call sites'
// contract hasn't silently changed shape underneath them.

describe('can()', () => {
  it('grants projects.create under the default tier for any orgId', () => {
    expect(can('20000000-0000-0000-0000-00000000000a', 'projects.create')).toBe(true);
    expect(can('some-other-org-id', 'projects.create')).toBe(true);
  });

  it('is not sensitive to orgId (single hardcoded tier, see header comment)', () => {
    const a = can('org-a', 'projects.create');
    const b = can('org-b', 'projects.create');
    expect(a).toBe(b);
  });

  // Gate 1.5 (PHASE_0_FINDINGS.md SS O.3): 'readiness.checker'/
  // 'readiness.override' added alongside 'projects.create' in the same
  // DEFAULT_TIER -- same "one hardcoded tier, no orgId branching" contract
  // as the existing key above.
  it('grants readiness.checker and readiness.override under the default tier for any orgId', () => {
    expect(can('20000000-0000-0000-0000-00000000000a', 'readiness.checker')).toBe(true);
    expect(can('some-other-org-id', 'readiness.checker')).toBe(true);
    expect(can('20000000-0000-0000-0000-00000000000a', 'readiness.override')).toBe(true);
    expect(can('some-other-org-id', 'readiness.override')).toBe(true);
  });

  it('readiness.checker/readiness.override are not sensitive to orgId', () => {
    expect(can('org-a', 'readiness.checker')).toBe(can('org-b', 'readiness.checker'));
    expect(can('org-a', 'readiness.override')).toBe(can('org-b', 'readiness.override'));
  });

  // Gate 1.6 deferred work (PHASE_0_FINDINGS.md SS Q.6): 'jurisdiction.requirements'
  // added alongside the existing keys in the same DEFAULT_TIER -- same
  // "one hardcoded tier, no orgId branching" contract as every key above.
  it('grants jurisdiction.requirements under the default tier for any orgId', () => {
    expect(can('20000000-0000-0000-0000-00000000000a', 'jurisdiction.requirements')).toBe(true);
    expect(can('some-other-org-id', 'jurisdiction.requirements')).toBe(true);
  });

  it('jurisdiction.requirements is not sensitive to orgId', () => {
    expect(can('org-a', 'jurisdiction.requirements')).toBe(can('org-b', 'jurisdiction.requirements'));
  });

  // Gate 1.7 (PHASE_0_FINDINGS.md SS S): 'analytics' added alongside the
  // existing keys in the same DEFAULT_TIER -- same "one hardcoded tier, no
  // orgId branching" contract as every key above.
  it('grants analytics under the default tier for any orgId', () => {
    expect(can('20000000-0000-0000-0000-00000000000a', 'analytics')).toBe(true);
    expect(can('some-other-org-id', 'analytics')).toBe(true);
  });

  it('analytics is not sensitive to orgId', () => {
    expect(can('org-a', 'analytics')).toBe(can('org-b', 'analytics'));
  });
});

describe('limit()', () => {
  it('returns a positive projects.active_max for any orgId', () => {
    const value = limit('20000000-0000-0000-0000-00000000000a', 'projects.active_max');
    expect(value).toBeGreaterThan(0);
  });

  it('is not sensitive to orgId (single hardcoded tier, see header comment)', () => {
    const a = limit('org-a', 'projects.active_max');
    const b = limit('org-b', 'projects.active_max');
    expect(a).toBe(b);
  });
});
