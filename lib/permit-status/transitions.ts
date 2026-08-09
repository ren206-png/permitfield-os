// Lifecycle & Compliance Expansion, Phase 1.3: application-layer mirror of
// supabase/migrations/20260806000022_permit_status_machine.sql's
// `permit_status_transitions` table, `permit_status_tier()` function, and
// the role-tier checks inside `transition_permit_status()`.
//
// *** WHY THIS DUPLICATES SQL LOGIC IN TYPESCRIPT ***
// Same discipline as lib/jurisdictions/staleness.ts (Phase 1.2): the SQL
// side (`permit_status_transitions` + `transition_permit_status()`) is the
// actual enforcement — nothing in this file can stop an illegal write, since
// this module has no DB access of its own. This file exists so a future UI
// can ask "is this move even legal" / "what role would this require" without
// a round-trip (e.g. disabling an illegal next-state button, or client-side
// pre-validating before calling the RPC and getting a nicer error than a raw
// Postgres exception). See docs/STATUS_TRANSITIONS.md for the full picture
// (the legal transition graph, why each edge exists, the three role tiers)
// and this file's own test for the cross-check against that document's
// tables — this module has no DB access, so the check is against the
// *documented* transition set, not a live query.
//
// *** THIS DOES NOT MUTATE ANYTHING AND HAS NO CALL SITE YET. *** Same
// "schema/logic exists, nothing in app/ reads it yet" pattern as every prior
// gate's infrastructure-ahead-of-its-consumer modules (lib/audit/log.ts,
// lib/jurisdictions/staleness.ts). See lib/flags.ts's
// isApplicationsEnabled() header comment.

export type PermitStatus =
  | 'intake'
  | 'requirements_review'
  | 'collecting_documents'
  | 'internal_review'
  | 'ready_to_submit'
  | 'withdrawn'
  | 'submitted'
  | 'under_municipal_review'
  | 'revision_requested'
  | 'resubmitted'
  | 'appeal_filed'
  | 'approved'
  | 'rejected'
  | 'issued'
  | 'expired'
  | 'closed';

// All 16 values, in the same order as the SQL enum
// (`permit_status_enum`, 20260806000022) -- exported so tests/UI can
// enumerate without duplicating the literal list a third time.
export const ALL_PERMIT_STATUSES: readonly PermitStatus[] = [
  'intake',
  'requirements_review',
  'collecting_documents',
  'internal_review',
  'ready_to_submit',
  'withdrawn',
  'submitted',
  'under_municipal_review',
  'revision_requested',
  'resubmitted',
  'appeal_filed',
  'approved',
  'rejected',
  'issued',
  'expired',
  'closed',
];

export type PermitStatusTier = 'org' | 'submission' | 'jurisdiction_outcome';

// Mirrors permit_status_tier()'s exact CASE branching (20260806000022).
// docs/STATUS_TRANSITIONS.md's "16 statuses and their three role tiers"
// table is the narrative version of this same map.
export const PERMIT_STATUS_TIER: Record<PermitStatus, PermitStatusTier> = {
  intake: 'org',
  requirements_review: 'org',
  collecting_documents: 'org',
  internal_review: 'org',
  ready_to_submit: 'org',
  withdrawn: 'org',
  submitted: 'submission',
  under_municipal_review: 'submission',
  revision_requested: 'jurisdiction_outcome',
  resubmitted: 'jurisdiction_outcome',
  appeal_filed: 'jurisdiction_outcome',
  approved: 'jurisdiction_outcome',
  rejected: 'jurisdiction_outcome',
  issued: 'jurisdiction_outcome',
  expired: 'jurisdiction_outcome',
  closed: 'jurisdiction_outcome',
};

export function permitStatusTier(status: PermitStatus): PermitStatusTier {
  return PERMIT_STATUS_TIER[status];
}

// Mirrors permit_status_transitions' seed rows exactly (20260806000022) --
// `null` here is the from-side of that table's one `(null, 'intake')` row,
// representing "a brand new application" rather than any real prior status.
// docs/STATUS_TRANSITIONS.md's transition table is the narrative version of
// this same map; keep both, and the SQL seed rows, in sync by hand -- this
// file's test cross-checks this map against that document's table, not
// against a live database (see this file's header comment).
export const PERMIT_STATUS_TRANSITIONS: Record<PermitStatus | 'null', readonly PermitStatus[]> = {
  null: ['intake'],
  intake: ['requirements_review', 'withdrawn'],
  requirements_review: ['collecting_documents', 'withdrawn'],
  collecting_documents: ['internal_review', 'withdrawn'],
  internal_review: ['ready_to_submit', 'collecting_documents', 'withdrawn'],
  ready_to_submit: ['submitted', 'collecting_documents', 'withdrawn'],
  submitted: ['under_municipal_review'],
  under_municipal_review: ['revision_requested', 'approved', 'rejected', 'issued'],
  revision_requested: ['collecting_documents', 'resubmitted', 'withdrawn'],
  resubmitted: ['under_municipal_review'],
  approved: ['issued', 'expired'],
  rejected: ['appeal_filed', 'closed'],
  appeal_filed: ['under_municipal_review', 'approved', 'rejected', 'closed'],
  issued: ['expired', 'closed'],
  expired: ['closed'],
  closed: [],
  withdrawn: [],
};

// Mirrors transition_permit_status()'s "Check 1" exactly: is (from, to) a
// legal edge, independent of who is asking. `from` is `null` for the one
// legal "brand new application" edge.
export function isValidPermitStatusTransition(from: PermitStatus | null, to: PermitStatus): boolean {
  const key = from ?? 'null';
  return PERMIT_STATUS_TRANSITIONS[key].includes(to);
}

// *** DOES NOT MIRROR CHECK 5. *** Gate 1.5
// (supabase/migrations/20260806000025_readiness_checklist.sql,
// PHASE_0_FINDINGS.md SS O.2) added a stateful precondition to
// transition_permit_status() on the internal_review -> ready_to_submit edge
// specifically: every required readiness_checklist_items row must be
// complete, or a readiness override must already be recorded on the
// application. That is a live, per-row database fact (not a static
// (from, to) edge or a static role-tier rule), so unlike Check 1/Check 2
// above it cannot be mirrored as a pure, DB-independent function in this
// file -- isValidPermitStatusTransition(internal_review, ready_to_submit)
// legitimately returns true even when Check 5 would still reject the actual
// RPC call. A future UI wanting to pre-flight Check 5 client-side needs an
// actual query (readiness_checklist_complete()/compute_readiness_score(),
// both in 20260806000025), not this module.

// The three org_role values from lib/authz's Role union that this module
// cares about, kept as a local, narrower alias so this file does not need to
// import lib/authz's full Role type just to describe role-tier membership --
// same "duplicated, cross-checked list" discipline as everything else in
// this file, not a second source of truth for what roles exist.
export type PermitStatusRole =
  | 'owner'
  | 'org_owner'
  | 'platform_admin'
  | 'member'
  | 'permit_manager'
  | 'permit_coordinator'
  | 'applicant_contractor'
  | 'document_reviewer'
  | 'client_user'
  | 'auditor_readonly';

// Mirrors transition_permit_status()'s "Check 2" role sets exactly
// (20260806000022): org-tier destinations accept the full existing
// permit_applications-write role set; submission-tier requires
// permit_manager or above; jurisdiction_outcome-tier requires
// permit_coordinator or above.
export const ORG_TIER_ROLES: readonly PermitStatusRole[] = [
  'owner',
  'org_owner',
  'platform_admin',
  'member',
  'permit_manager',
  'permit_coordinator',
  'applicant_contractor',
];

export const SUBMISSION_TIER_ROLES: readonly PermitStatusRole[] = [
  'owner',
  'org_owner',
  'platform_admin',
  'permit_manager',
];

export const JURISDICTION_OUTCOME_TIER_ROLES: readonly PermitStatusRole[] = [
  'owner',
  'org_owner',
  'platform_admin',
  'permit_manager',
  'permit_coordinator',
];

const TIER_ROLES: Record<PermitStatusTier, readonly PermitStatusRole[]> = {
  org: ORG_TIER_ROLES,
  submission: SUBMISSION_TIER_ROLES,
  jurisdiction_outcome: JURISDICTION_OUTCOME_TIER_ROLES,
};

// Mirrors transition_permit_status()'s "Check 2" exactly: is this role
// allowed to move an application INTO the tier `to` belongs to. Does not
// check transition legality at all (that's isValidPermitStatusTransition,
// deliberately a separate function -- see this file's header comment and
// the migration's own comment on why the two checks stay independent).
export function canRoleTransitionTo(role: PermitStatusRole, to: PermitStatus): boolean {
  const tier = permitStatusTier(to);
  return TIER_ROLES[tier].includes(role);
}
