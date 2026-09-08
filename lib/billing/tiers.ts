// BILLING_PROPOSAL.md's ratified pricing model: pure, DB-free tier
// configuration. No DB access, no Stripe SDK, no env reads -- same
// "DB-independent, unit-testable" discipline lib/entitlements/index.ts's own
// header comment established for its (until this build) single hardcoded
// DEFAULT_TIER. This file is the *data* half of that seam (tier name ->
// price/limits/features); lib/entitlements/index.ts is the *lookup* half
// (which tier does a given org resolve to, right now, given its
// org_subscriptions row and the current time).
//
// Entitlement/LimitKey are defined HERE, not in lib/entitlements/index.ts
// (where they lived before this build), so this module has zero dependency
// on that one. lib/entitlements/index.ts imports BILLING_TIERS et al. from
// here and re-exports these two types for its existing call site's
// convenience (app/(app)/projects/new/actions.ts's `import { can as
// entitlementCan, limit } from '@/lib/entitlements'` never imported the
// types directly, but keeping the re-export means it could without a
// breaking change) -- the dependency direction is one-way, entitlements ->
// tiers, never the reverse, so there is no circular import between the two.

export type Entitlement =
  | 'projects.create'
  | 'readiness.checker'
  | 'readiness.override'
  | 'jurisdiction.requirements'
  | 'analytics'
  | 'ai';
export type LimitKey = 'projects.active_max';

export type BillingTierId = 'starter' | 'pro' | 'enterprise';

export interface BillingTierInfo {
  id: BillingTierId;
  name: string;
  // Cents, matching Stripe's own smallest-currency-unit convention. null for
  // enterprise, which has no self-serve Checkout price at all -- "talk to
  // sales," see SELF_SERVE_TIERS below.
  priceCents: number | null;
  features: readonly Entitlement[];
  limits: Record<LimitKey, number>;
}

const ALL_FEATURES: readonly Entitlement[] = [
  'projects.create',
  'readiness.checker',
  'readiness.override',
  'jurisdiction.requirements',
  'analytics',
  'ai',
];

// BILLING_PROPOSAL.md §2's ratified two-self-serve-tier + Enterprise table
// (collapsed from an original four-tier draft per Ren's "what is your
// recommendation" / "yes"). Enterprise's limit is Number.MAX_SAFE_INTEGER
// rather than a sentinel like -1 or null, so every caller that compares a
// live count against this limit (app/(app)/projects/new/actions.ts's
// `count >= maxActiveProjects`) keeps working unchanged -- "unlimited" is
// just a limit no real org will ever reach, not a special case call sites
// need to branch on.
export const BILLING_TIERS: Record<BillingTierId, BillingTierInfo> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceCents: 14900,
    features: ['projects.create', 'readiness.checker'],
    limits: { 'projects.active_max': 10 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceCents: 49900,
    features: ALL_FEATURES,
    limits: { 'projects.active_max': 50 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceCents: null,
    features: ALL_FEATURES,
    limits: { 'projects.active_max': Number.MAX_SAFE_INTEGER },
  },
};

// Self-serve tiers only -- the ones a Checkout Session can be created for.
// Enterprise is deliberately excluded (BILLING_PROPOSAL.md §3: "no
// self-serve Stripe Checkout -- sales-assisted only"); the billing settings
// page renders it as a "talk to sales" card with no Checkout button.
export const SELF_SERVE_TIERS: readonly BillingTierId[] = ['starter', 'pro'];

// BILLING_PROPOSAL.md §2: 14-day no-card trial, defaulting to Pro-tier
// features -- matches the existing "14 days" convention GATE_2_0_SPEC.md §7
// already established for client-portal token TTL (not load-bearing, just
// consistent with a number already picked once in this codebase).
export const TRIAL_DAYS = 14;
export const TRIAL_TIER: BillingTierId = 'pro';

export function isBillingTierId(value: string): value is BillingTierId {
  return value === 'starter' || value === 'pro' || value === 'enterprise';
}
