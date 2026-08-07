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
