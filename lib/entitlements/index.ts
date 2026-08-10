// Lifecycle & Compliance Expansion, Phase 1.1: application-layer
// entitlements seam.
//
// *** THIS IS NOT A REAL BILLING/SUBSCRIPTION SYSTEM. *** The master
// prompt's S4 calls for enforcing plan limits on this phase's new
// create-project flow via "the existing subscription system"; Phase 0's
// audit (PHASE_0_FINDINGS.md) found no such system anywhere in this
// codebase -- no plans/subscriptions table, no billing provider
// integration, nothing. Building a real one (pricing tiers, a
// Stripe-or-equivalent integration, upgrade flows) is its own project and
// out of scope for a project-intake gate. This file is the minimal
// alternative the spec's requirement still needs satisfied: a single
// hardcoded default tier applied to every org, exposed through the same
// `can()`-style pure-function shape lib/authz/index.ts already
// established -- DB-independent and unit-testable, so a future real
// billing phase can replace the *implementation* behind `can()`/`limit()`
// without touching any call site (every caller already asks "can/limit",
// never "what tier is this org on" directly).
//
// Do not read "every org gets the same generous limit" as a pricing
// decision -- it only means this phase does not implement per-org billing.
// This module has exactly one call site as of this phase:
// app/(app)/projects/new/actions.ts's createProject Server Action, which
// combines this with a live count query (this module has no DB access of
// its own, same discipline as lib/authz) to decide whether an org may
// create another active project.

// 'readiness.checker' / 'readiness.override' added in Gate 1.5
// (PHASE_0_FINDINGS.md SS O.3): the master prompt's S4 spells these
// `readiness_checker` / `readiness_override` (its literal key list), but
// this module's one existing key (`projects.create`) already established a
// dot-namespaced `resource.action` convention -- SS O.3 is the user's
// explicit decision to keep extending that convention rather than adopt the
// master prompt's literal spelling. Neither key has a call site yet: the
// override role gate itself is enforced in SQL
// (override_readiness_check(), 20260806000025) since that is the one thing
// a SECURITY DEFINER RPC actually can enforce; these two keys exist so a
// future Route Handler/Server Action wrapping that RPC (and the checklist
// UI generally) has them ready to call, same "declared now, enforced later
// at the call site" pattern every flag in lib/flags.ts already follows.
// 'jurisdiction.requirements' added in Gate 1.6's deferred work
// (PHASE_0_FINDINGS.md SS P.5, confirmed unchanged in SS Q.6): the master
// prompt's S4 spells this `jurisdiction_requirements` (its literal key
// list), same divergence SS O.3 already established for
// `readiness_checker`/`readiness_override` above -- kept dot-namespaced for
// consistency rather than mixing spelling conventions within this file. No
// call site yet: neither evaluate_project_permit_requirements() nor
// review_project_permit_requirement() (20260806000027) enforce role gates
// via this module -- the review RPC's permit_manager+ check is done in SQL,
// same "the DB enforces what a DB-layer RPC actually can enforce" reasoning
// SS O.3's readiness keys already established. This key exists so a future
// Route Handler/Server Action wrapping either RPC has it ready to call.
export type Entitlement =
  | 'projects.create'
  | 'readiness.checker'
  | 'readiness.override'
  | 'jurisdiction.requirements';
export type LimitKey = 'projects.active_max';

interface EntitlementTier {
  name: string;
  features: readonly Entitlement[];
  limits: Record<LimitKey, number>;
}

// The one and only tier. Every org resolves to this today -- see the module
// header for why.
const DEFAULT_TIER: EntitlementTier = {
  name: 'default',
  features: ['projects.create', 'readiness.checker', 'readiness.override', 'jurisdiction.requirements'],
  limits: {
    'projects.active_max': 50,
  },
};

// orgId is accepted (not swallowed as `_orgId`-only-for-signature) even
// though the current implementation never branches on it, so every call
// site is already shaped correctly for the day a real per-org tier lookup
// replaces the hardcoded constant below -- no call site would need to
// change, only this function's body.
export function can(orgId: string, entitlement: Entitlement): boolean {
  void orgId;
  return DEFAULT_TIER.features.includes(entitlement);
}

export function limit(orgId: string, key: LimitKey): number {
  void orgId;
  return DEFAULT_TIER.limits[key];
}
