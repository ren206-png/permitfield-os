// Lifecycle & Compliance Expansion, Phase 1.1 origin; extended by
// BILLING_PROPOSAL.md's ratified Stripe billing build.
//
// This module used to be a stub: "no real billing system exists, hardcode
// one generous default tier for every org" (see git history for that
// original header). That is no longer true -- supabase/migrations/
// 20260806000040_org_subscriptions.sql adds a real per-org subscription
// table synced from Stripe, and lib/billing/tiers.ts defines the real tier
// config (Starter/Pro/Enterprise). This module is still the seam every call
// site goes through (`can()`/`limit()`, never "what tier is this org on"
// directly) -- what changed is what's behind that seam.
//
// Flag-gated (PERMITFIELD_FF_BILLING, lib/flags.ts's isBillingEnabled()):
// off-path is byte-identical to this file's pre-billing behavior (the old
// hardcoded DEFAULT_TIER, now LEGACY_DEFAULT_TIER below) -- same "off-path
// must not change behavior" discipline isMarketingV2Enabled/
// isJurisdictionPagesEnabled already established elsewhere in this repo.
// On-path resolves a live org_subscriptions row.
//
// can()/limit() are now async (they were sync before) because the on-path
// requires a DB read -- this is a breaking signature change for both call
// sites (app/(app)/projects/new/actions.ts, and this file's own test
// suite), both updated alongside this file.
//
// resolveEffectiveTier() is deliberately pure (row + now() in, ResolvedTier
// out, no Supabase client) and exported specifically so it can be unit
// tested directly without mocking Supabase -- no vitest test file anywhere
// in this codebase mocks Supabase, so DB-touching logic (resolveOrgTier)
// stays a thin wrapper around this pure core rather than being tested
// itself.
import { createClient } from '@/lib/supabase/server';
import { isBillingEnabled } from '@/lib/flags';
import { BILLING_TIERS, type BillingTierId, type Entitlement, type LimitKey } from '@/lib/billing/tiers';

// Re-exported for the one existing call site (and any future one) that
// imports these types from this module rather than lib/billing/tiers
// directly -- the types themselves now live in lib/billing/tiers.ts to
// avoid a circular import (this file imports BILLING_TIERS etc. from
// there; keeping the types there too keeps the dependency strictly
// one-way).
export type { Entitlement, LimitKey };

interface ResolvedTier {
  name: string;
  features: readonly Entitlement[];
  limits: Record<LimitKey, number>;
}

// The pre-billing hardcoded tier, preserved verbatim as the off-path
// (PERMITFIELD_FF_BILLING=false) fallback -- every org got every feature
// and a 50-project limit before this build, and must continue to when the
// flag is off.
const LEGACY_DEFAULT_TIER: ResolvedTier = {
  name: 'default',
  features: [
    'projects.create',
    'readiness.checker',
    'readiness.override',
    'jurisdiction.requirements',
    'analytics',
    'ai',
  ],
  limits: {
    'projects.active_max': 50,
  },
};

// What an org resolves to when it has no usable subscription: no row at
// all (predates this migration in an environment that reset/seeded around
// it), a canceled subscription, or an expired trial with no card on file.
// Zero features, zero project headroom -- read-only, not an error; existing
// data stays visible (nothing here deletes or hides rows), only
// `projects.create` and the rest of the feature set are denied.
const NO_PLAN_TIER: ResolvedTier = {
  name: 'no_plan',
  features: [],
  limits: {
    'projects.active_max': 0,
  },
};

export interface OrgSubscriptionRow {
  tier: BillingTierId;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trial_ends_at: string | null;
}

// Pure: no DB access, no Date.now() call of its own (now defaults to
// `new Date()` but accepts an override so tests can pin a clock). A
// canceled subscription, or a trialing one whose trial_ends_at has already
// passed, resolves to NO_PLAN_TIER regardless of which tier column value
// it still carries -- 'trialing'/'active'/'past_due' with a
// still-in-the-future (or null) trial_ends_at resolve to that row's actual
// tier from BILLING_TIERS.
export function resolveEffectiveTier(row: OrgSubscriptionRow | null, now: Date = new Date()): ResolvedTier {
  if (!row || row.status === 'canceled') {
    return NO_PLAN_TIER;
  }
  if (row.status === 'trialing' && row.trial_ends_at !== null && new Date(row.trial_ends_at).getTime() <= now.getTime()) {
    return NO_PLAN_TIER;
  }
  return BILLING_TIERS[row.tier];
}

// DB-touching wrapper around resolveEffectiveTier() -- deliberately thin
// (one query, one call to the pure function) so the branching logic worth
// testing stays in the pure function above.
async function resolveOrgTier(orgId: string): Promise<ResolvedTier> {
  if (!isBillingEnabled()) {
    return LEGACY_DEFAULT_TIER;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_subscriptions')
    .select('tier, status, trial_ends_at')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    // Fail closed (no features) rather than throw -- a transient DB error
    // here must not be interpreted as "grant everything."
    console.error(`Failed to resolve org_subscriptions for org ${orgId}:`, error.message);
    return NO_PLAN_TIER;
  }

  return resolveEffectiveTier(data);
}

// orgId is accepted (not swallowed) the same way it always was in this
// file's pre-billing version -- now it's actually used on the on-path.
export async function can(orgId: string, entitlement: Entitlement): Promise<boolean> {
  const tier = await resolveOrgTier(orgId);
  return tier.features.includes(entitlement);
}

export async function limit(orgId: string, key: LimitKey): Promise<number> {
  const tier = await resolveOrgTier(orgId);
  return tier.limits[key];
}
