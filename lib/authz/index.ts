// Lifecycle & Compliance Expansion, Phase 1.0: application-layer permission
// model. Pure and DB-independent on purpose -- no Supabase import here, no
// network call, so this file is unit-testable without a live database (this
// repo's first test target; see lib/authz/index.test.ts).
//
// *** THIS MODULE IS NOT WIRED INTO ANY ROUTE YET. *** See docs/PERMISSIONS.md
// and the Phase 1.0 report's "What's NOT done" section for the full
// explanation. Concretely: every existing Route Handler in this repo
// (app/api/**) still enforces access exclusively through Postgres RLS via
// is_org_member()/is_org_owner() (e.g. the review/route.ts this phase's audit
// re-read re-derives finding->audit->application and relies on RLS to 404 a
// cross-tenant id). Nothing here changes that. This file exists so a later
// phase's routes have a single, testable place to ask "can this role do this
// action to this resource" instead of re-deriving ad hoc booleans inline --
// it is foundation, not enforcement, in Phase 1.0.
//
// Assigning a new Role value to a real org_members row today (Phase 1.0) has
// ZERO effect on what that user can actually do: RLS still only branches on
// is_org_member (true for every new role, since org_members.role is not null
// regardless of value) and is_org_owner (true ONLY for the literal 'owner'
// value -- see supabase/migrations/20260806000002). A 'platform_admin' row
// today is, at the database layer, an ordinary member. Do not assign the new
// roles to real users expecting the permissions below to be enforced until
// the phase that wires can() into routes ships.

// Superset of the legacy two-value org_role enum
// (supabase/migrations/20260806000002_organizations_and_members.sql) and the
// 8 values additively appended in
// 20260806000018_lifecycle_rbac_roles_and_audit_log.sql. Kept as a single
// flat union (not legacy | new) because callers read a role off org_members
// and should not need to care which migration introduced it.
export type Role =
  | 'owner'
  | 'member'
  | 'platform_admin'
  | 'org_owner'
  | 'permit_manager'
  | 'permit_coordinator'
  | 'document_reviewer'
  | 'applicant_contractor'
  | 'client_user'
  | 'auditor_readonly';

// 'archive' rather than 'delete': this codebase's global rule (see
// PHASE_0_FINDINGS.md SS F) is that user-facing destructive actions are
// soft/archival, never a hard DELETE -- even though several *current* RLS
// policies (e.g. permit_applications_delete, contractors_delete) do issue
// real hard deletes today. The Action vocabulary here describes the target
// model this phase is laying groundwork for, not literally what happens at
// the SQL layer yet; see docs/PERMISSIONS.md's two-table split for that
// distinction spelled out per-resource.
export type Action = 'create' | 'read' | 'update' | 'archive';

// One entry per tenant-scoped table/concept a role might act on. Intentionally
// coarser than raw table names in a couple of places: `audit_findings_review`
// (not `audit_findings`) names specifically the confirm/dismiss action this
// repo's app/api/applications/[id]/findings/[findingId]/review/route.ts
// performs -- the underlying rows are otherwise AI-written and not something
// any role "creates" or "updates" outside that one reviewable field set.
// Lifecycle & Compliance Expansion, Phase 1.1 adds the four resources below
// (taxonomies/clients/properties/projects, from
// 20260806000019_lifecycle_intake_properties_clients_taxonomies.sql). Same
// "not wired into any route" caveat from the module header applies to these
// too, EXCEPT that this phase's own createProject Server Action
// (app/(app)/projects/new/actions.ts) IS this module's first real call
// site -- see that file's header comment. It calls can() for the
// 'projects' resource only; the other three new resources remain
// aspirational alongside every pre-Phase-1.1 entry until something calls
// can() for them too.
export type Resource =
  | 'organizations'
  | 'org_members'
  | 'contractors'
  | 'permit_applications'
  | 'application_documents'
  | 'extractions'
  | 'audits'
  | 'audit_findings_review'
  | 'generated_documents'
  | 'audit_logs'
  | 'taxonomies'
  | 'clients'
  | 'properties'
  | 'projects';

type PermissionMatrix = Record<Role, Partial<Record<Resource, readonly Action[]>>>;

// Reasoning per role lives here, next to the data it produced, rather than
// only in the phase report -- so it stays correct if the matrix is edited
// later without anyone re-reading a report from a prior phase.
//
// - owner / member (legacy): mirrored 1:1 from *actual current RLS policies*
//   (not aspirational), so assigning these two well-understood values never
//   implies more than the DB already grants. Citations inline.
// - org_owner: the new role intended to eventually *replace* 'owner' as the
//   role assigned to new orgs (never a rename -- see the migration's header
//   comment). Given the identical permission surface to 'owner' so that
//   switching an org from 'owner' to 'org_owner' in a later phase is a no-op
//   for this matrix.
// - platform_admin: PermitField's own staff, cross-org support/ops access.
//   Full surface, including audit_logs read (an admin investigating an
//   incident needs the ledger). No table in this schema currently
//   distinguishes "PermitField staff" from "org member" -- see
//   docs/PERMISSIONS.md's open gap on this.
// - permit_manager / permit_coordinator / document_reviewer: three
//   internal-staff tiers narrower than owner, spanning the day-to-day
//   permitting workflow at decreasing scope (manager: broad operational
//   control minus org/member administration; coordinator: works
//   applications/documents day-to-day; document_reviewer: focused on the
//   finding-review step specifically).
// - applicant_contractor: the contractor-org user actually filing permits --
//   today's 'member' in practice, given the same surface as 'member' plus
//   explicit acknowledgment it is the intended long-term replacement for
//   that value in contractor-facing orgs.
// - client_user: the contractor's own client (e.g. property owner) --
//   deliberately minimal per the master prompt's explicit Phase-1 deferral of
//   a client-facing portal. DO NOT assign to a real user: RLS does not
//   actually restrict this role today (see the module header comment), so
//   the read-only surface below is aspirational, not enforced.
// - auditor_readonly: read-only across the board, including audit_logs
//   (the one role besides owner-tier roles that can see it) -- an external or
//   internal compliance auditor's entire job is reading the trail, never
//   acting on it.
const READ_ONLY_LOG: readonly Action[] = ['read'];
const SELF_LOG: readonly Action[] = ['create', 'read'];
const REVIEW: readonly Action[] = ['read', 'update'];
const FULL: readonly Action[] = ['create', 'read', 'update', 'archive'];

const ownerAndOrgOwnerGrants: PermissionMatrix['owner'] = {
  // organizations_update requires is_org_owner (20260806000002 L90-93); no
  // direct INSERT policy exists on organizations at all -- creation only
  // happens via create_organization_with_owner(), outside this matrix's scope.
  organizations: ['read', 'update'],
  // org_members_insert/update/delete all require is_org_owner (L100-111).
  org_members: FULL,
  // contractors_delete requires is_org_owner; select/insert/update only
  // require is_org_member (20260806000003).
  contractors: FULL,
  // permit_applications_delete requires is_org_owner; select/insert/update
  // only require is_org_member (20260806000006).
  permit_applications: FULL,
  // application_documents has no UPDATE policy for anyone (uploads are
  // immutable) and its DELETE policy only requires is_org_member, not
  // is_org_owner (20260806000006 L100-118) -- 'archive' granted here reflects
  // that any member, owner or not, can delete a document today.
  application_documents: ['create', 'read', 'archive'],
  extractions: SELF_LOG,
  audits: SELF_LOG,
  audit_findings_review: REVIEW,
  generated_documents: ['create', 'read'],
  audit_logs: SELF_LOG,
  // taxonomies_insert/update require is_org_owner, same as org_members
  // (20260806000019) -- taxonomies is org-wide shared configuration, not a
  // per-record working set, so it gets the same owner-only write shape as
  // org_members rather than contractors/projects' member-writable shape.
  taxonomies: FULL,
  // clients/properties/projects_insert/update only require is_org_member
  // (20260806000019), same shape as contractors/permit_applications -- and
  // unlike those two, none of the three has a real DELETE at the DB layer at
  // all (archival-only, see that migration's header comment), so the
  // is_org_member-gated UPDATE policy is the only mechanism for both
  // "update" and "archive" -- FULL is not an overgrant here the way it would
  // require is_org_owner for contractors/permit_applications' actual DELETE.
  clients: FULL,
  properties: FULL,
  projects: FULL,
};

const matrix: PermissionMatrix = {
  owner: ownerAndOrgOwnerGrants,
  org_owner: ownerAndOrgOwnerGrants,
  platform_admin: {
    organizations: FULL,
    org_members: FULL,
    contractors: FULL,
    permit_applications: FULL,
    application_documents: FULL,
    extractions: SELF_LOG,
    audits: SELF_LOG,
    audit_findings_review: REVIEW,
    generated_documents: FULL,
    audit_logs: ['create', 'read'],
    taxonomies: FULL,
    clients: FULL,
    properties: FULL,
    projects: FULL,
  },
  // Mirrors current RLS exactly (see contractors_select/insert/update,
  // permit_applications_select/insert/update, application_documents_select/
  // insert/delete -- all is_org_member-only, no is_org_owner requirement) --
  // this row intentionally grants NOTHING beyond what a plain member already
  // has today, since 'member' predates this phase.
  member: {
    organizations: READ_ONLY_LOG,
    contractors: ['create', 'read', 'update'],
    permit_applications: ['create', 'read', 'update'],
    application_documents: ['create', 'read', 'archive'],
    extractions: READ_ONLY_LOG,
    audits: READ_ONLY_LOG,
    // app/api/applications/[id]/findings/[findingId]/review/route.ts checks
    // only is_org_member (via the finding->audit->application chain), so any
    // member -- not just owners -- can confirm/dismiss today.
    audit_findings_review: REVIEW,
    generated_documents: READ_ONLY_LOG,
    audit_logs: SELF_LOG,
    // No org_members entry: a plain member cannot manage the roster today
    // (org_members_insert/update/delete all require is_org_owner).
    // clients/properties/projects mirror contractors/permit_applications
    // above: is_org_member-gated insert/update, no owner-only DELETE exists
    // for these three (archival-only), so FULL is the correct ceiling, not
    // an overgrant -- see ownerAndOrgOwnerGrants' comment on the same point.
    taxonomies: READ_ONLY_LOG,
    clients: FULL,
    properties: FULL,
    projects: FULL,
  },
  permit_manager: {
    organizations: READ_ONLY_LOG,
    org_members: READ_ONLY_LOG,
    contractors: FULL,
    permit_applications: FULL,
    application_documents: FULL,
    extractions: SELF_LOG,
    audits: SELF_LOG,
    audit_findings_review: REVIEW,
    generated_documents: ['create', 'read'],
    audit_logs: SELF_LOG,
    // Same tier as org_members above: taxonomies is org-wide shared
    // configuration, and permit_manager's whole design is "broad
    // operational control MINUS org/member administration" (see the
    // matrix's top-of-file reasoning comment) -- read-only here for the
    // same reason it's read-only on org_members.
    taxonomies: READ_ONLY_LOG,
    clients: FULL,
    properties: FULL,
    projects: FULL,
  },
  permit_coordinator: {
    organizations: READ_ONLY_LOG,
    contractors: ['create', 'read', 'update'],
    permit_applications: ['create', 'read', 'update'],
    application_documents: ['create', 'read', 'update'],
    extractions: READ_ONLY_LOG,
    audits: READ_ONLY_LOG,
    audit_findings_review: REVIEW,
    generated_documents: READ_ONLY_LOG,
    audit_logs: SELF_LOG,
    taxonomies: READ_ONLY_LOG,
    clients: ['create', 'read', 'update'],
    properties: ['create', 'read', 'update'],
    projects: ['create', 'read', 'update'],
  },
  document_reviewer: {
    organizations: READ_ONLY_LOG,
    contractors: READ_ONLY_LOG,
    permit_applications: READ_ONLY_LOG,
    application_documents: ['create', 'read', 'archive'],
    extractions: READ_ONLY_LOG,
    audits: READ_ONLY_LOG,
    audit_findings_review: REVIEW,
    generated_documents: READ_ONLY_LOG,
    audit_logs: SELF_LOG,
    // Reviewer's job is the finding-review step, not project intake -- kept
    // read-only across all four new resources, same tier as
    // contractors/permit_applications above.
    taxonomies: READ_ONLY_LOG,
    clients: READ_ONLY_LOG,
    properties: READ_ONLY_LOG,
    projects: READ_ONLY_LOG,
  },
  applicant_contractor: {
    organizations: READ_ONLY_LOG,
    contractors: ['create', 'read', 'update'],
    permit_applications: ['create', 'read', 'update'],
    application_documents: ['create', 'read', 'archive'],
    extractions: READ_ONLY_LOG,
    audits: READ_ONLY_LOG,
    audit_findings_review: REVIEW,
    generated_documents: READ_ONLY_LOG,
    audit_logs: SELF_LOG,
    taxonomies: READ_ONLY_LOG,
    clients: ['create', 'read', 'update'],
    properties: ['create', 'read', 'update'],
    projects: ['create', 'read', 'update'],
  },
  // Deliberately sparse -- see the header comment above the matrix. No
  // audit_logs entry at all: a client neither reads the ledger nor performs
  // actions worth self-logging in this model.
  client_user: {
    permit_applications: READ_ONLY_LOG,
    generated_documents: READ_ONLY_LOG,
    // A client can plausibly see their own project's status and the
    // property it's filed against, but NOT the `clients` row itself (that's
    // the org's internal CRM record about them, e.g. `notes`, and no
    // no-entry is a deliberately more conservative default than the sparse
    // read access granted elsewhere) and NOT taxonomies (internal
    // classification, not client-facing). Same "aspirational, RLS enforces
    // none of this yet" caveat as the rest of this role -- see the module
    // header and this matrix's top-of-file comment.
    properties: READ_ONLY_LOG,
    projects: READ_ONLY_LOG,
  },
  auditor_readonly: {
    organizations: READ_ONLY_LOG,
    org_members: READ_ONLY_LOG,
    contractors: READ_ONLY_LOG,
    permit_applications: READ_ONLY_LOG,
    application_documents: READ_ONLY_LOG,
    extractions: READ_ONLY_LOG,
    audits: READ_ONLY_LOG,
    audit_findings_review: READ_ONLY_LOG,
    generated_documents: READ_ONLY_LOG,
    // Can read the ledger (the whole point of the role) and can write an
    // entry describing their own access to it, but never anything else.
    audit_logs: SELF_LOG,
    taxonomies: READ_ONLY_LOG,
    clients: READ_ONLY_LOG,
    properties: READ_ONLY_LOG,
    projects: READ_ONLY_LOG,
  },
};

// Table-driven, not a switch -- adding a role or resource is a data change
// to `matrix` above, not a new branch here. Returns false (never throws) for
// any role/resource pair with no matrix entry, so an unrecognized or
// not-yet-modeled combination fails closed.
export function can(role: Role, action: Action, resource: Resource): boolean {
  const allowed = matrix[role]?.[resource];
  return allowed ? allowed.includes(action) : false;
}

// Exposed for docs/PERMISSIONS.md generation and for tests that need to
// assert coverage (e.g. "every Role has at least one Resource entry") without
// duplicating the literal role/resource lists.
export const ALL_ROLES: readonly Role[] = [
  'owner',
  'member',
  'platform_admin',
  'org_owner',
  'permit_manager',
  'permit_coordinator',
  'document_reviewer',
  'applicant_contractor',
  'client_user',
  'auditor_readonly',
];

export const ALL_RESOURCES: readonly Resource[] = [
  'organizations',
  'org_members',
  'contractors',
  'permit_applications',
  'application_documents',
  'extractions',
  'audits',
  'audit_findings_review',
  'generated_documents',
  'audit_logs',
  'taxonomies',
  'clients',
  'properties',
  'projects',
];

export const ALL_ACTIONS: readonly Action[] = ['create', 'read', 'update', 'archive'];
