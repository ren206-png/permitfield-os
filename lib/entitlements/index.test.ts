import { describe, it, expect } from 'vitest';
import { can, limit, resolveEffectiveTier, type OrgSubscriptionRow } from './index';

// Lifecycle & Compliance Expansion, Phase 1.1 origin; extended by
// BILLING_PROPOSAL.md's ratified Stripe billing build (see index.ts's own
// header comment for the full history).
//
// can()/limit() are now async (they call a DB-aware resolveOrgTier()
// internally), so every assertion below awaits them. These tests
// deliberately run with PERMITFIELD_FF_BILLING unset -- vitest's default
// process env, same as every other test file in this repo -- which means
// isBillingEnabled() is false and can()/limit() take the legacy,
// DB-untouched path (LEGACY_DEFAULT_TIER). That's intentional: no test file
// anywhere in this codebase mocks Supabase (see index.ts's header comment),
// so the on-path (a live org_subscriptions lookup) is exercised indirectly
// via resolveEffectiveTier() below instead -- a pure function that accepts
// a row directly and needs no DB client at all.

describe('can() (PERMITFIELD_FF_BILLING off -- legacy path)', () => {
  it('grants projects.create under the legacy default tier for any orgId', async () => {
    expect(await can('20000000-0000-0000-0000-00000000000a', 'projects.create')).toBe(true);
    expect(await can('some-other-org-id', 'projects.create')).toBe(true);
  });

  it('is not sensitive to orgId (single hardcoded tier, see index.ts header)', async () => {
    const a = await can('org-a', 'projects.create');
    const b = await can('org-b', 'projects.create');
    expect(a).toBe(b);
  });

  it('grants readiness.checker and readiness.override under the legacy default tier for any orgId', async () => {
    expect(await can('20000000-0000-0000-0000-00000000000a', 'readiness.checker')).toBe(true);
    expect(await can('some-other-org-id', 'readiness.checker')).toBe(true);
    expect(await can('20000000-0000-0000-0000-00000000000a', 'readiness.override')).toBe(true);
    expect(await can('some-other-org-id', 'readiness.override')).toBe(true);
  });

  it('readiness.checker/readiness.override are not sensitive to orgId', async () => {
    expect(await can('org-a', 'readiness.checker')).toBe(await can('org-b', 'readiness.checker'));
    expect(await can('org-a', 'readiness.override')).toBe(await can('org-b', 'readiness.override'));
  });

  it('grants jurisdiction.requirements under the legacy default tier for any orgId', async () => {
    expect(await can('20000000-0000-0000-0000-00000000000a', 'jurisdiction.requirements')).toBe(true);
    expect(await can('some-other-org-id', 'jurisdiction.requirements')).toBe(true);
  });

  it('jurisdiction.requirements is not sensitive to orgId', async () => {
    expect(await can('org-a', 'jurisdiction.requirements')).toBe(await can('org-b', 'jurisdiction.requirements'));
  });

  it('grants analytics under the legacy default tier for any orgId', async () => {
    expect(await can('20000000-0000-0000-0000-00000000000a', 'analytics')).toBe(true);
    expect(await can('some-other-org-id', 'analytics')).toBe(true);
  });

  it('analytics is not sensitive to orgId', async () => {
    expect(await can('org-a', 'analytics')).toBe(await can('org-b', 'analytics'));
  });

  it('grants ai under the legacy default tier for any orgId', async () => {
    expect(await can('20000000-0000-0000-0000-00000000000a', 'ai')).toBe(true);
    expect(await can('some-other-org-id', 'ai')).toBe(true);
  });

  it('ai is not sensitive to orgId', async () => {
    expect(await can('org-a', 'ai')).toBe(await can('org-b', 'ai'));
  });
});

describe('limit() (PERMITFIELD_FF_BILLING off -- legacy path)', () => {
  it('returns a positive projects.active_max for any orgId', async () => {
    const value = await limit('20000000-0000-0000-0000-00000000000a', 'projects.active_max');
    expect(value).toBeGreaterThan(0);
  });

  it('is not sensitive to orgId (single hardcoded tier, see index.ts header)', async () => {
    const a = await limit('org-a', 'projects.active_max');
    const b = await limit('org-b', 'projects.active_max');
    expect(a).toBe(b);
  });
});

// resolveEffectiveTier() is the pure core of the billing on-path
// (PERMITFIELD_FF_BILLING=true) -- exercised directly here since it needs
// no Supabase client, unlike resolveOrgTier() which wraps it.
describe('resolveEffectiveTier()', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');

  it('resolves to the no-plan tier (zero features) when there is no row at all', () => {
    const tier = resolveEffectiveTier(null, now);
    expect(tier.features).toEqual([]);
    expect(tier.limits['projects.active_max']).toBe(0);
  });

  it('resolves to the no-plan tier when status is canceled, regardless of tier column', () => {
    const row: OrgSubscriptionRow = { tier: 'pro', status: 'canceled', trial_ends_at: null };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toEqual([]);
  });

  it('resolves to the no-plan tier when trialing and trial_ends_at has already passed', () => {
    const row: OrgSubscriptionRow = {
      tier: 'pro',
      status: 'trialing',
      trial_ends_at: '2026-08-01T00:00:00.000Z',
    };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toEqual([]);
  });

  it('resolves to the row tier when trialing and trial_ends_at is still in the future', () => {
    const row: OrgSubscriptionRow = {
      tier: 'pro',
      status: 'trialing',
      trial_ends_at: '2026-09-15T00:00:00.000Z',
    };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toContain('projects.create');
    expect(tier.features).toContain('ai');
  });

  it('resolves to the row tier when trialing and trial_ends_at is null (should not happen post-migration, but must not crash)', () => {
    const row: OrgSubscriptionRow = { tier: 'starter', status: 'trialing', trial_ends_at: null };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toContain('projects.create');
  });

  it('resolves to the row tier when active, independent of trial_ends_at', () => {
    const row: OrgSubscriptionRow = {
      tier: 'starter',
      status: 'active',
      trial_ends_at: '2026-08-01T00:00:00.000Z',
    };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toContain('projects.create');
    // Starter is deliberately narrower than Pro (BILLING_PROPOSAL.md §2) --
    // confirms this isn't accidentally resolving to the all-features tier.
    expect(tier.features).not.toContain('analytics');
  });

  it('resolves to the row tier when past_due (still has access -- past_due is not a hard cutoff)', () => {
    const row: OrgSubscriptionRow = { tier: 'pro', status: 'past_due', trial_ends_at: null };
    const tier = resolveEffectiveTier(row, now);
    expect(tier.features).toContain('projects.create');
  });

  it('starter tier has a narrower projects.active_max limit than pro', () => {
    const starterRow: OrgSubscriptionRow = { tier: 'starter', status: 'active', trial_ends_at: null };
    const proRow: OrgSubscriptionRow = { tier: 'pro', status: 'active', trial_ends_at: null };
    const starter = resolveEffectiveTier(starterRow, now);
    const pro = resolveEffectiveTier(proRow, now);
    expect(starter.limits['projects.active_max']).toBeLessThan(pro.limits['projects.active_max']);
  });
});
