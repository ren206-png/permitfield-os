# Permissions

Two tables. **They are not the same thing, and this phase does not merge
them.** Table 1 is what Postgres actually enforces today, for every request,
regardless of anything below. Table 2 is the target application-layer model
introduced in `lib/authz/index.ts` (Lifecycle & Compliance Expansion, Phase
1.0) -- it has zero call sites in the codebase as of this phase and changes
no behavior by existing. See "Current status" at the bottom before assuming
anything in Table 2 is live.

## Table 1 — Current DB-enforced reality

Source of truth: `supabase/migrations/`. Every row below is a direct citation
of an existing RLS policy, not an inference. `org_role` today has 10 possible
values (`owner`, `member`, plus the 8 added in
`20260806000018_lifecycle_rbac_roles_and_audit_log.sql`), but only two of
them mean anything to any policy: `is_org_owner()` checks for the literal
`'owner'` value and nothing else (`20260806000002` L43-54); every other
policy only calls `is_org_member()`, which is true for a row with ANY role
value. Concretely: a `permit_manager` row is, at the database layer, an
ordinary member -- indistinguishable from `member` for every policy that
exists today.

| Table | SELECT | INSERT | UPDATE | DELETE | Citation |
|---|---|---|---|---|---|
| `organizations` | `is_org_member` | *(no policy — only via `create_organization_with_owner()` RPC)* | `is_org_owner` | *(no policy — no delete path exists)* | `20260806000002` |
| `org_members` | `is_org_member` | `is_org_owner` | `is_org_owner` | `is_org_owner` | `20260806000002` |
| `contractors` | `is_org_member` | `is_org_member` | `is_org_member` | `is_org_owner` | `20260806000003` |
| `permit_applications` | `is_org_member` | `is_org_member` | `is_org_member` | `is_org_owner` | `20260806000006` |
| `application_documents` | `is_org_member` (via parent application) | `is_org_member` (via parent) | *(no policy — uploads are immutable)* | `is_org_member` (via parent — **not owner-restricted**) | `20260806000006` |
| `extractions` | `is_org_member` (via parent) | *(no policy for `authenticated`; `service_role` only, `20260806000015`)* | *(none — append-only, trigger-enforced)* | *(none — append-only, trigger-enforced)* | `20260806000007` |
| `audits` | `is_org_member` (via parent) | *(`service_role` only)* | *(none — append-only)* | *(none — append-only)* | `20260806000009` |
| `audit_findings` | `is_org_member` (via parent) | *(`service_role` only)* | `is_org_member`, but a trigger further restricts the update to `review_status`/`reviewed_by`/`reviewed_at` only (`audit_findings_restrict_update_trigger`) | *(none — `forbid_delete()` trigger)* | `20260806000009` |
| `generated_documents` | `is_org_member` (via parent) | *(`service_role` only, Phase 4)* | *(none — append-only)* | *(none — append-only)* | `20260806000017` |
| `audit_logs` (new, Phase 1.0) | `can_read_audit_logs` — **narrower than `is_org_member`**: only `role in ('owner','org_owner','platform_admin','auditor_readonly')` | `is_org_member(org_id) and actor_user_id = auth.uid()` | *(none — append-only, trigger-enforced)* | *(none — append-only, trigger-enforced)* | `20260806000018` |
| `taxonomies` (new, Phase 1.1) | `is_org_member` | `is_org_owner` | `is_org_owner` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `clients` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `properties` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `projects` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |

Notable properties this table makes explicit:

- **`taxonomies` is the first table since `audit_logs` whose write policy is
  narrower than plain `is_org_member`** — INSERT/UPDATE both require
  `is_org_owner`, while SELECT only requires membership. This is the opposite
  asymmetry from `audit_logs` (which restricts SELECT, not write); documented
  here so the two "narrower than membership" tables in this schema aren't
  conflated with each other.
- **`taxonomies`/`clients`/`properties`/`projects` have no DELETE policy at
  all**, by design: this phase introduces `archived_at timestamptz` on all
  four and treats archival (a plain UPDATE setting that column) as the
  destructive-action path, rather than adding a real DELETE policy. RLS
  itself does not filter out archived rows on SELECT — that's an
  application-layer concern this phase does not implement (see the
  migration's header comment).
- **`clients`/`properties`/`projects` are additionally guarded by composite
  foreign keys** (`unique (org_id, id)` on the referenced table +
  `foreign key (org_id, x_id) references x (org_id, id)` on the referencing
  table), not just RLS. A cross-org `client_id`/`property_id`/`contractor_id`/
  `taxonomy_id` value is rejected by the FK constraint itself
  (`foreign_key_violation`, SQLSTATE 23503) before RLS is even relevant —
  this closes the gap `permit_applications`'s pre-existing bare-id FKs
  (`20260806000006`) leave open, a gap this migration's header comment
  describes but does not retroactively fix (out of scope for an
  additive-only phase). See `supabase/tests/lifecycle_intake.test.sql` for
  the executable proof.
- **`clients`/`properties`/`projects` also have a second, `security
  definer` write path**: `create_project_with_intake()`
  (`20260806000020`), the same RPC-wrapping pattern
  `create_organization_with_owner()` uses for `organizations`/`org_members`
  above. It exists to make the inline "create a client, a property, and a
  project together" flow (`app/(app)/projects/new/actions.ts`) atomic —
  three separate `.insert()` calls used to each be their own transaction,
  so a failure partway through could leave an orphaned client or property
  row behind. Because `security definer` bypasses the
  `clients_insert`/`properties_insert`/`projects_insert` policies in this
  table entirely, the function does its own `is_org_member(p_org_id)`
  check as its first statement — this is *not* a weaker path than the
  table's own RLS policies, just a differently-enforced one covering the
  same boundary. See `supabase/tests/lifecycle_intake.test.sql`'s
  `create_project_with_intake()` tests (happy path, atomic rollback on
  failure, and cross-org `p_org_id` rejection) for the executable proof.

- **No role beyond `owner` vs. everyone-else exists at the DB layer today.**
  The 8 new `org_role` values added in Phase 1.0 are legal to store in
  `org_members.role` but do not change a single query result anywhere in this
  schema yet.
- **`application_documents` DELETE is not owner-restricted**, unlike
  `contractors`/`permit_applications`. Any org member can delete any document
  in their org today. This asymmetry is pre-existing (predates Phase 1.0) and
  is called out here rather than silently "fixed", since fixing it is a
  behavior change this phase's additive-only discipline does not authorize.
- **`audit_logs` is the first table in this schema whose SELECT policy is
  narrower than plain `is_org_member`.** Every other table in this list uses
  org membership as the entire read boundary; `audit_logs` additionally
  requires an elevated role.
- Service-role (`service_role`) access is a *separate* grant layer from RLS
  (`service_role` has `BYPASSRLS` but holds no table privileges of its own —
  see `20260806000015`'s header comment) and is omitted from the table above
  except where it's the *only* writer, to keep this table answering "what can
  a signed-in user's own session do."

## Table 2 — Target application-layer model (`lib/authz/index.ts`)

This is the `can(role, action, resource)` matrix, reproduced here for
readability (see the source file for the authoritative version and the
per-role reasoning comments). **Aspirational.** No route calls `can()` yet.

Legend: C = create, R = read, U = update, A = archive. A blank cell means
the matrix has no entry for that role/resource pair (`can()` returns `false`).

This table is checked against `lib/authz/index.ts`'s live matrix by
`lib/authz/permissions-doc.test.ts` (`npm test`), which parses the table
below straight out of this file and fails if any cell disagrees with
`formatPermissionCell()`'s output for the corresponding role/resource pair.
Edit the code and this table together; the test is what catches it if you
don't.

| Role | organizations | org_members | contractors | permit_applications | application_documents | extractions | audits | audit_findings_review | generated_documents | audit_logs | taxonomies | clients | properties | projects |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `owner` | R,U | C,R,U,A | C,R,U,A | C,R,U,A | C,R,A | C,R | C,R | R,U | C,R | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A |
| `org_owner` | R,U | C,R,U,A | C,R,U,A | C,R,U,A | C,R,A | C,R | C,R | R,U | C,R | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A |
| `platform_admin` | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | C,R | C,R | R,U | C,R,U,A | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A |
| `member` | R | | C,R,U | C,R,U | C,R,A | R | R | R,U | R | C,R | R | C,R,U,A | C,R,U,A | C,R,U,A |
| `permit_manager` | R | R | C,R,U,A | C,R,U,A | C,R,U,A | C,R | C,R | R,U | C,R | C,R | R | C,R,U,A | C,R,U,A | C,R,U,A |
| `permit_coordinator` | R | | C,R,U | C,R,U | C,R,U | R | R | R,U | R | C,R | R | C,R,U | C,R,U | C,R,U |
| `document_reviewer` | R | | R | R | C,R,A | R | R | R,U | R | C,R | R | R | R | R |
| `applicant_contractor` | R | | C,R,U | C,R,U | C,R,A | R | R | R,U | R | C,R | R | C,R,U | C,R,U | C,R,U |
| `client_user` | | | | R | | | | | R | | | | R | R |
| `auditor_readonly` | R | R | R | R | R | R | R | R | R | C,R | R | R | R | R |

Notes on deliberate asymmetries vs. Table 1:

- `Action` here is `'create' | 'read' | 'update' | 'archive'` — **not**
  `'delete'**. This repo's destructive-action convention is soft/archival, so
  the target model names the action `archive` even though the *current* DB
  layer (Table 1) performs real hard deletes for `contractors`,
  `permit_applications`, and `application_documents`. Wiring `can()`'s
  `archive` check into a route in a later phase does not, by itself,
  soft-delete anything — the underlying DELETE statements would need their
  own migration to add an `archived_at` column, which does not exist yet
  (confirmed absent repo-wide during the Phase 0 audit).
- `owner`/`org_owner`/`member`/`applicant_contractor` rows above are
  citation-backed against Table 1 (see `lib/authz/index.ts`'s inline
  comments citing migration line numbers) — they are meant to *equal*
  current behavior, not expand it, for the two legacy roles.
- `platform_admin`, `permit_manager`, `permit_coordinator`,
  `document_reviewer`, `client_user`, `auditor_readonly` are new-role rows
  with no DB-layer counterpart to cite — they are product/design decisions
  made during this phase's planning, documented in `lib/authz/index.ts`'s
  comments, not derived from existing enforcement.
- `client_user` is intentionally near-empty and should not be assigned to a
  real user. See the warning below.
- **`taxonomies`/`clients`/`properties`/`projects` (Phase 1.1) are new-role
  rows, added the same way `permit_manager`/`permit_coordinator`/
  `document_reviewer`/`client_user`/`auditor_readonly` were in Phase 1.0 —
  product/design decisions, not citations of pre-existing DB behavior beyond
  `taxonomies`' owner-tier write gate (which *is* citation-backed, see Table
  1 above). `member`/`permit_manager` get the full `C,R,U,A` on
  `clients`/`properties`/`projects` — since archival on these three tables
  is just an UPDATE setting `archived_at` (see Table 1's notes), not a
  separate owner-only DELETE the way `contractors`/`permit_applications`
  have, there is no narrower ceiling to hold either role to.
  `permit_coordinator`/`applicant_contractor` get only `C,R,U` (no `A`) on
  the same three — a deliberate narrower tier for those two roles, matching
  the fact that they also lack `A` on `contractors`/`permit_applications`
  elsewhere in this table. All four of `member`/`permit_manager`/
  `permit_coordinator`/`applicant_contractor` get only `R` on `taxonomies`,
  mirroring the DB-layer asymmetry: `is_org_owner` gates taxonomies writes,
  `is_org_member` gates the other three. `client_user` gets `R` on
  `properties`/`projects` only (not `clients`/`taxonomies`) — a
  client-facing user can see the property and project they're attached to,
  but has no reason to see the org's internal client list or taxonomy
  configuration.

## Current status (read this before assigning any new role)

- **Do not assign any of the 8 new `org_role` values to a real user yet.**
  Doing so today does not grant or restrict anything beyond what `member`
  already has (except for `audit_logs` read access, since
  `can_read_audit_logs()` — a real RLS-layer function, not aspirational —
  does check for `'platform_admin'` and `'auditor_readonly'` by name; every
  other table ignores the new values entirely).
  `client_user` in particular is the one role in Table 2 designed to be
  *more* restrictive than a plain member, and RLS provides none of that
  restriction today — assigning it does not sandbox anyone.
- **`can()` becomes meaningful only once a Route Handler or Server Action
  calls it.** Zero do, as of Phase 1.0. A future phase's report should update
  this section (and this file's "Current status") when the first call site
  lands, rather than leaving this warning stale.
- **`lib/audit/log.ts`'s `writeAuditLog()` is infrastructure only.** No
  existing route calls it. The `audit_logs` table exists and its RLS/grants
  are live, but it has no writers in this codebase yet.
