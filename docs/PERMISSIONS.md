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
| `application_documents` | `is_org_member` (via parent application) | `is_org_member` (via parent) | *(no policy for `authenticated` — mutations only via `replace_application_document()`/`archive_application_document()`, both `security definer`; Gate 1.4)* | *(no policy — hard delete removed in Gate 1.4; archival only via `archive_application_document()`)* | `20260806000006`, `20260806000024` |
| `document_revisions` (new, Gate 1.4) | `is_org_member` (via `application_documents` → parent application, two-hop join) | *(no policy for `authenticated` — only writers are the `seed_document_revision()` trigger and `replace_application_document()`, both `security definer`)* | *(none — append-only, `forbid_update_delete()` trigger-enforced)* | *(none — append-only, `forbid_update_delete()` trigger-enforced)* | `20260806000024` |
| `extractions` | `is_org_member` (via parent) | *(no policy for `authenticated`; `service_role` only, `20260806000015`)* | *(none — append-only, trigger-enforced)* | *(none — append-only, trigger-enforced)* | `20260806000007` |
| `audits` | `is_org_member` (via parent) | *(`service_role` only)* | *(none — append-only)* | *(none — append-only)* | `20260806000009` |
| `audit_findings` | `is_org_member` (via parent) | *(`service_role` only)* | `is_org_member`, but a trigger further restricts the update to `review_status`/`reviewed_by`/`reviewed_at` only (`audit_findings_restrict_update_trigger`) | *(none — `forbid_delete()` trigger)* | `20260806000009` |
| `generated_documents` | `is_org_member` (via parent) | *(`service_role` only, Phase 4)* | *(none — append-only)* | *(none — append-only)* | `20260806000017` |
| `audit_logs` (new, Phase 1.0) | `can_read_audit_logs` — **narrower than `is_org_member`**: only `role in ('owner','org_owner','platform_admin','auditor_readonly')` | `is_org_member(org_id) and actor_user_id = auth.uid()` | *(none — append-only, trigger-enforced)* | *(none — append-only, trigger-enforced)* | `20260806000018` |
| `taxonomies` (new, Phase 1.1) | `is_org_member` | `is_org_owner` | `is_org_owner` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `clients` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `properties` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `projects` (new, Phase 1.1) | `is_org_member` | `is_org_member` | `is_org_member` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000019` |
| `jurisdiction_sources` (new, Phase 1.2) | `true` (any authenticated, no role/org check at all) | `is_platform_admin` | `is_platform_admin`, `with check` additionally requires `verified_by is null or verified_by = auth.uid()` | *(no policy — archival via `archived_at`, no delete path exists)* | `20260806000021` |
| `application_status_history` (new, Phase 1.3) | `is_org_member` | *(no policy for `authenticated` — the only writers are `seed_permit_status_history()` and `transition_permit_status()`, both `security definer`)* | *(none — append-only, `forbid_update_delete()` trigger-enforced)* | *(none — append-only, `forbid_update_delete()` trigger-enforced)* | `20260806000022` |
| `readiness_checklist_items` (new, Gate 1.5) | `is_org_member` | `is_org_member` | `is_org_member` | `is_org_owner` | `20260806000025` |

Notable properties this table makes explicit:

- **`jurisdiction_sources` is global reference data, not org-scoped** — like
  `jurisdictions`/`authorities` (`20260806000004`), its SELECT policy has no
  `org_id` or membership check at all; every authenticated user across every
  org sees the same rows. Unlike `jurisdictions`/`authorities` (write
  restricted to `service_role` only, no `authenticated` write policy
  whatsoever), `jurisdiction_sources` grants `authenticated` INSERT/UPDATE
  directly, gated by a **new** helper, `is_platform_admin()` — the first RLS
  policy in this schema besides `can_read_audit_logs()` to check the
  `'platform_admin'` role value by name rather than treating all
  `org_role` values as equivalent to `is_org_member`. See this migration's
  header comment for why a new function was added instead of widening
  `is_org_owner()`, and the "Current status" section below for what this
  does and does not change about `platform_admin` elsewhere in the schema.
- **`verify_jurisdiction_source(source_id, status, notes, clear_notes)` is the
  sanctioned write path for the verification action** (`security definer`,
  same RPC-wrapping pattern as `create_organization_with_owner`/
  `create_project_with_intake`) — it re-checks `is_platform_admin()` itself
  (bypassing RLS the way every `security definer` function here does) and
  always sets `verified_by = auth.uid()` server-side; there is no parameter
  that accepts a caller-supplied `verified_by`, so this path has no forgery
  vector at all, stronger than the base UPDATE policy's `with check`.
  `clear_notes` (default `false`) is an explicit opt-in to null out an
  existing note — `notes` alone can only set/preserve a note, never clear
  one, since a bare `coalesce(p_notes, notes)` cannot distinguish "caller
  passed nothing" from "caller wants this cleared."
- **Staleness is computed at read time, not stored.** `verification_status`
  can be persisted as `'stale'` (it's a legal enum value), but nothing in
  this migration ever writes it — there is no scheduled job in this repo.
  `jurisdiction_source_effective_status(verification_status, verified_at,
  threshold_days default 180)` is a plain `stable` SQL function every read
  path must call to get the true current status; reading the column
  directly can show a 180+-day-old `'verified'` row as still `'verified'`.
  See the migration's header comment for why a cron-based approach was
  rejected.

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
- **`application_documents` DELETE was not owner-restricted — CLOSED in Gate
  1.4.** Previously any org member could delete any document in their org;
  this asymmetry was pre-existing (predates Phase 1.0) and was called out
  here rather than silently "fixed," since fixing it was a behavior change
  Phase 1.0's additive-only discipline did not authorize at the time.
  `20260806000024_lifecycle_documents_revisions.sql` removes the raw
  `application_documents_delete` policy and revokes the table-level `DELETE`
  grant from `authenticated` entirely — hard delete is no longer a reachable
  path for anyone, at any role. The replacement, `archive_application_document()`
  (`security definer`), gates archival to the roles holding `archive` on
  `application_documents` in Table 2 below (`owner`, `org_owner`,
  `platform_admin`, `member`, `permit_manager`, `document_reviewer`,
  `applicant_contractor` — notably **not** `permit_coordinator`, which has
  `update` but not `archive` on this resource) — narrower than "any org
  member," and enforced inside the function body rather than via RLS, since
  a single `is_org_member`-gated policy cannot express a role-specific rule
  the way an in-function role check can. See `PHASE_0_FINDINGS.md` §N for a
  related question this same migration deliberately left unresolved at the
  time (who can write the review columns it also added) — now resolved:
  `document_reviewer`, per the Table 2 notes below.
- **`audit_logs` is the first table in this schema whose SELECT policy is
  narrower than plain `is_org_member`.** Every other table in this list uses
  org membership as the entire read boundary; `audit_logs` additionally
  requires an elevated role.
- **`application_status_history` has no INSERT/UPDATE/DELETE policy for
  `authenticated` at all** — stricter than every other append-only table in
  this list (`extractions`/`audits`/`generated_documents`, all `service_role`-
  write), since even `service_role` has no direct INSERT policy here either;
  the only two writers are `security definer` functions
  (`seed_permit_status_history()`, fired by an `AFTER INSERT` trigger on
  `permit_applications`, and `transition_permit_status()`, the sanctioned RPC
  for every subsequent status change) that both write as the table owner,
  bypassing RLS the same way `create_organization_with_owner()` does. This is
  deliberate: a status history row must always correspond to a real,
  validated transition, never a direct client-side insert.
- **`permit_status_transitions` (new, Phase 1.3) is global reference data,
  same shape as `jurisdiction_sources`/`jurisdictions`** — `select using
  (true)` for `authenticated`, no write policy at all (seeded once by the
  migration itself, 33 rows encoding the full legal transition graph — see
  `docs/STATUS_TRANSITIONS.md`). Not modeled as a `lib/authz` `Resource`, same
  reasoning as `jurisdictions`/`authorities`: no role ever writes it, so there
  is no permission distinction to express.
- **`permit_applications` (Gate 1.5) gains three new columns —
  `readiness_override_at`/`readiness_override_by`/`readiness_override_reason`
  — with NO update grant for `authenticated` at all**, same column-level
  lockout pattern the `status` column already uses (`20260806000022`):
  `revoke update on permit_applications from authenticated; grant update
  (status) on permit_applications to authenticated;` from Gate 1.3 already
  excludes any column not explicitly listed, so the three new columns are
  closed by construction, zero additional migration statements required. The
  one sanctioned writer is `override_readiness_check()` (`security definer`,
  `20260806000025`), gated to `permit_manager` or above, which also inserts
  an `audit_logs` row (`action = 'readiness_override'`) as part of the same
  write. `transition_permit_status()` itself is also modified in this gate
  (full `create or replace`, since plpgsql has no incremental
  `ALTER FUNCTION ... ADD CHECK`) to add a new precondition ("Check 5") on
  the `internal_review → ready_to_submit` edge specifically: every required
  `readiness_checklist_items` row must be `complete`, unless a readiness
  override is already recorded. See `docs/STATUS_TRANSITIONS.md`'s "The
  readiness gate" section for the full mechanism.
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

| Role | organizations | org_members | contractors | permit_applications | application_documents | extractions | audits | audit_findings_review | generated_documents | audit_logs | taxonomies | clients | properties | projects | jurisdiction_sources | application_status_history | readiness_checklist_items |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `owner` | R,U | C,R,U,A | C,R,U,A | C,R,U,A | C,R,A | C,R | C,R | R,U | C,R | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | R | R | C,R,U,A |
| `org_owner` | R,U | C,R,U,A | C,R,U,A | C,R,U,A | C,R,A | C,R | C,R | R,U | C,R | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | R | R | C,R,U,A |
| `platform_admin` | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | C,R | C,R | R,U | C,R,U,A | C,R | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | C,R,U,A | R | C,R,U,A |
| `member` | R | | C,R,U | C,R,U | C,R,A | R | R | R,U | R | C,R | R | C,R,U,A | C,R,U,A | C,R,U,A | R | R | C,R,U |
| `permit_manager` | R | R | C,R,U,A | C,R,U,A | C,R,U,A | C,R | C,R | R,U | C,R | C,R | R | C,R,U,A | C,R,U,A | C,R,U,A | R | R | C,R,U,A |
| `permit_coordinator` | R | | C,R,U | C,R,U | C,R,U | R | R | R,U | R | C,R | R | C,R,U | C,R,U | C,R,U | R | R | C,R,U |
| `document_reviewer` | R | | R | R | C,R,U,A | R | R | R,U | R | C,R | R | R | R | R | R | R | R |
| `applicant_contractor` | R | | C,R,U | C,R,U | C,R,A | R | R | R,U | R | C,R | R | C,R,U | C,R,U | C,R,U | R | R | C,R,U |
| `client_user` | | | | R | | | | | R | | | | R | R | | R | R |
| `auditor_readonly` | R | R | R | R | R | R | R | R | R | C,R | R | R | R | R | R | R | R |

Notes on deliberate asymmetries vs. Table 1:

- `Action` here is `'create' | 'read' | 'update' | 'archive'` — **not**
  `'delete'`. This repo's destructive-action convention is soft/archival, so
  the target model names the action `archive` even though the *current* DB
  layer (Table 1) still performs real hard deletes for `contractors` and
  `permit_applications`. Wiring `can()`'s `archive` check into a route for
  either of those two does not, by itself, soft-delete anything — the
  underlying DELETE statements would need their own migration to add an
  `archived_at` column, which does not exist yet for either table (confirmed
  absent during the Phase 0 audit, still true as of Gate 1.4).
  **`application_documents` no longer belongs in that group, as of Gate
  1.4** (`20260806000024`): it now has a real `archived_at`/`archived_by`
  pair and a real, enforced archive-only path (`archive_application_document()`;
  hard DELETE removed entirely — see Table 1 above and its note on this
  table). This is the first resource in this document where Table 2's
  `archive` action and Table 1's actual enforcement mechanism agree in
  *shape* (soft-delete, role-gated) — though `can()` itself still has no
  call site anywhere in the app (see "Current status" below); the RPC
  enforces its own role list directly in SQL, independent of and not wired
  to `lib/authz/index.ts`'s matrix.
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
- **`jurisdiction_sources` (Phase 1.2) is the first *new* resource in this
  table whose grants ARE fully citation-backed against real RLS, for every
  role, not just the legacy two** — `jurisdiction_sources_select` is `using
  (true)` with no role branch (`20260806000021`), so every role except
  `client_user` gets `R` here as a direct citation, not a design guess; and
  `platform_admin`'s `C,R,U,A` is likewise a direct citation of
  `is_platform_admin()` gating INSERT/UPDATE, not the product-decision
  reasoning the rest of `platform_admin`'s row above carries. `client_user`
  is the one deliberate override of raw RLS here (see
  `lib/authz/index.ts`'s `client_user` comment) — verification bookkeeping
  is internal tooling metadata, not part of that role's product surface.
- **`application_status_history` (Phase 1.3) is the first *new* resource
  where literally every role, including `platform_admin`, is capped at `R`**
  — the opposite of `jurisdiction_sources`' `platform_admin` row just above.
  This IS citation-backed: the table has no INSERT/UPDATE/DELETE RLS policy
  for `authenticated` at all (Table 1 above), so there is no role for which
  granting more than `R` would reflect real enforcement, not even PermitField
  staff. `client_user` is granted `R` here too, unlike its `jurisdiction_sources`
  blank cell — a deliberate product-surface choice (not a citation, since RLS
  draws no distinction), reasoned in `lib/authz/index.ts`'s `client_user`
  comment: a client that can already read `permit_applications` has no
  reason to be blocked from that same application's status trail.
- **`application_documents` (Gate 1.4) — every role's cell is unchanged
  EXCEPT `document_reviewer`, which gains `U`.** `20260806000024` added
  `status`/`reviewed_by`/`reviewed_at`/`rejection_reason` columns but
  shipped **no RPC that writes them yet** (see `PHASE_0_FINDINGS.md` §N).
  §N's ambiguity is now resolved (user decision, Path 1): `document_reviewer`
  — the role literally named for reviewing documents — previously had
  `C,R,A` with no `U`, which was a contradictory reading (able to see and
  archive a document but not mark it reviewed). `document_reviewer` now
  carries `C,R,U,A` here and in `lib/authz/index.ts`'s matrix; every other
  role's `application_documents` cell is untouched. This `U` grant ships
  ahead of its RPC, same "matrix says yes before the write path exists"
  shape `permit_status`/`transition_permit_status()` had between Gate 1.3's
  schema and its RPC — `review_application_document()` is planned for a
  follow-up gate (1.4.1), not this one, so there is still no route or RPC
  in this repo that actually exercises this grant. `archive` maps to a
  real, enforced mechanism (`archive_application_document()`, see Table 1's
  notes) for exactly the roles already holding it in this table — Gate 1.4
  makes what Table 2 already claimed actually true at the DB layer for
  `archive`; it does not expand any role's `archive` grant.
- **`document_revisions` (new, Gate 1.4) is not modeled as a `lib/authz`
  `Resource`**, same reasoning as `permit_status_transitions`: it has no
  independent write path for any role at all (both its writers are
  `security definer`), so there is no permission distinction left for a
  matrix cell to express. Its SELECT visibility follows `application_documents`'
  own read boundary exactly (`is_org_member`, two-hop join) — any role that
  can read a document's current state can read its full revision history,
  and vice versa; nothing narrows one without the other.
- **Resolved: who may write `application_documents.status`/`reviewed_by`/
  `reviewed_at`/`rejection_reason`.** `PHASE_0_FINDINGS.md` §N is decided:
  `document_reviewer` holds `U` on `application_documents` as of this
  update (see bullet above) — that role, and only that role, is the
  intended writer of the review columns. No RPC enforces this yet; that is
  `review_application_document()`, scoped to Gate 1.4.1, not this gate. Do
  not infer a working document-review flow from this table until that RPC
  ships — the grant exists, the write path does not.

- **`readiness_checklist_items` (Gate 1.5) is given the exact same shape as
  `permit_applications`, not a fresh design** — both are real,
  citation-backed `is_org_member`-gated create/read/update with a real
  hard-`DELETE` restricted to `is_org_owner` (the `A` cell above), and both
  sit in `permit_status_tier()`'s `'org'`-tier reasoning ("the org's own
  work, self-attestation is correct here," `20260806000022`, reused verbatim
  in `20260806000025`'s header comment). `owner`/`org_owner`/`platform_admin`/
  `permit_manager` hold the full `C,R,U,A` ceiling; `member`/
  `permit_coordinator`/`applicant_contractor` hold `C,R,U` (no `A`) — the
  role actually completing checklist items day to day should not also be
  able to delete one outright, same reasoning `contractors`/
  `permit_applications` already apply elsewhere in this table.
  `document_reviewer`/`client_user`/`auditor_readonly` are `R`-only:
  `document_reviewer`'s job is the finding-review step, not the readiness
  checklist; `client_user`'s `R` mirrors its `application_status_history`
  cell just above (a client can already read the `permit_applications` row,
  and outstanding readiness items are strictly less sensitive than that
  row); `auditor_readonly` is `R`-only everywhere, unchanged. Deliberately
  NOT modeled as a matrix cell: `override_readiness_check()`'s own internal
  `permit_manager`-or-above role gate — same reasoning
  `transition_permit_status()`'s role-tier checks were never expressed as a
  matrix cell either, since it's a single dedicated RPC's own check, not a
  per-resource CRUD permission this table's vocabulary describes.

## Current status (read this before assigning any new role)

- **Do not assign any of the 8 new `org_role` values to a real user yet.**
  Doing so today does not grant or restrict anything beyond what `member`
  already has, **except**: `audit_logs` read access, since
  `can_read_audit_logs()` checks for `'platform_admin'` and
  `'auditor_readonly'` by name; and, as of Phase 1.2,
  `jurisdiction_sources` INSERT/UPDATE, since `is_platform_admin()`
  (`20260806000021`) checks for `'platform_admin'` by name too. Every other
  table still ignores the new values entirely.
  `client_user` in particular is the one role in Table 2 designed to be
  *more* restrictive than a plain member, and RLS provides none of that
  restriction today — assigning it does not sandbox anyone.
- **`platform_admin` is still not a first-class concept anywhere outside
  RLS.** `is_platform_admin()` (Phase 1.2) and `can_read_audit_logs()`
  (Phase 1.0) are both narrow, single-purpose SQL functions that check
  `org_role = 'platform_admin'` on a normal `org_members` row — there is
  still no table distinguishing "PermitField staff" from "org member," and
  `lib/auth/org-context.ts`'s `OrgContext.role` is still typed as
  `'owner' | 'member'` only, so no Route Handler or Server Action can
  currently even observe that a signed-in user is a `platform_admin`, let
  alone call `verify_jurisdiction_source()` on their behalf. A user with a
  `platform_admin` row can act as one only via direct SQL/RPC access (e.g.
  the Supabase SQL editor or a service script), not through the app. Widening
  `OrgContext` is deferred, not solved, by this phase — see the Gate 1.2
  report's "What is NOT done" section.
- **`can()` becomes meaningful only once a Route Handler or Server Action
  calls it.** Zero do, as of Phase 1.0. A future phase's report should update
  this section (and this file's "Current status") when the first call site
  lands, rather than leaving this warning stale.
- **`lib/audit/log.ts`'s `writeAuditLog()` is infrastructure only.** No
  existing route calls it. The `audit_logs` table exists and its RLS/grants
  are live, but it has no writers in this codebase yet.
- **`jurisdiction_sources` (Phase 1.2) is infrastructure only, same
  pattern.** The table, RLS, `is_platform_admin()`,
  `verify_jurisdiction_source()`, and `jurisdiction_source_effective_status()`
  all exist and are live, but nothing in `app/` reads or writes any of them
  yet — no UI, no Server Action, no Route Handler. `isJurisdictionsEnabled()`
  (`lib/flags.ts`) exists ahead of any consumer, same as
  `isLifecycleCoreEnabled()` did in Phase 1.0.
- **`application_status_history` / `permit_status_transitions` / `permit_status`
  (Phase 1.3) are infrastructure only, same pattern.** The tables, RLS,
  `permit_status_tier()`, and `transition_permit_status()` all exist and are
  live, but nothing in `app/` reads or writes any of them yet — no UI, no
  Server Action, no Route Handler. `isApplicationsEnabled()` (`lib/flags.ts`)
  exists ahead of any consumer, same as `isJurisdictionsEnabled()` did in
  Phase 1.2. See `docs/STATUS_TRANSITIONS.md` for the full transition graph
  and role-tier model this gate introduces.
- **`document_revisions` and the new `application_documents` columns (Gate
  1.4, `20260806000024`) are partial infrastructure — not the same "zero
  consumers" state as the bullets above.** `application_documents` itself is
  not new and already has a real consumer (`app/api/documents/route.ts`,
  the upload route, unchanged by this migration and still working via the
  pre-existing INSERT policy — plus `lib/inngest/functions/{extract,audit}.ts`,
  also unchanged). What's new and still unconsumed: no route calls
  `replace_application_document()` or `archive_application_document()` yet;
  no download route exists yet (`can()`'s first real call site, per
  `PHASE_0_FINDINGS.md` §M.3, is still pending); and no route or RPC writes
  `status`/`reviewed_by`/`reviewed_at`/`rejection_reason` at all yet — §N's
  authorization question is resolved (`document_reviewer` holds `U` on
  `application_documents`, see Table 2 notes above), but its RPC,
  `review_application_document()`, is scoped to a follow-up gate (1.4.1),
  not this one. `isDocumentsEnabled()`/`PERMITFIELD_FF_DOCUMENTS` do not
  exist in `lib/flags.ts` yet either — planned but not yet added as of this
  migration.
- **`readiness_checklist_items` / `permit_applications.readiness_override_*`
  (Gate 1.5) are infrastructure only, same pattern.** The table, RLS,
  `compute_readiness_score()`, `readiness_checklist_complete()`,
  `override_readiness_check()`, and the new Check 5 inside
  `transition_permit_status()` all exist and are live, but nothing in `app/`
  reads or writes any of them yet — no UI, no Server Action, no Route
  Handler. `isReadinessEnabled()` (`lib/flags.ts`) exists ahead of any
  consumer, same as `isApplicationsEnabled()` did in Phase 1.3. See
  `docs/STATUS_TRANSITIONS.md`'s "The readiness gate" section for the full
  mechanism.
