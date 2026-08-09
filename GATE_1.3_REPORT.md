# GATE 1.3 REPORT — Permit Applications Status State Machine

Branch: `feat/permitfield-phase-1.3-permit-status-machine`
Commits covered: originally `6077d9f`/`b00a89e`/`66b882d`/`862fde5` (rounds
1–4, in that order); this branch was then **rebased onto `main`** (round 4b,
below), which rewrote every commit hash — the current tip as of this report
is `6536d2b` (round 4's privilege fix, same content as `862fde5` before the
rebase), sitting on top of `d0e49ac`/`ca3dbda`/`548bead` (rounds 1–3,
rewritten) and `main`'s `f9015da`/`e3e1fda`/`4adb1fc` (the three pre-existing
test-file fixes this branch picked up via the rebase), plus the round-4b
report-correction commit described in §7/§9/§10 below (about to be committed
alongside this update).
This is the first `§6 GATE <n> REPORT` written in this repo. Per explicit
instruction, Gates 1.0–1.2 are **not** retroactively documented here or
anywhere else — this report covers Gate 1.3 only.

**Framing, stated up front, updated from round 3, then again after the
round-4b rebase:** round 3's execution (the first time this branch's SQL had
ever actually been run, against a real Postgres instance under RLS) revealed
a privilege-bypass defect in the column-level lockout approach — a
column-level `REVOKE` layered on top of a pre-existing table-level `GRANT`,
which is a no-op in Postgres's privilege model. That defect was root-caused,
documented, and reported without being silently patched (round 3's framing:
"Gate 1.3 discovering a failure static review missed"). Round 4 implements
and verifies the actual fix — `REVOKE` table-level `UPDATE` from
`authenticated` entirely, then `GRANT` it back only on the one column with a
legitimate direct-write call site (`status`). Round 4 also found and fixed a
real regression the fix caused in `tenant_isolation.test.sql` (not a Gate
1.3 file). After round 4's commit was pushed, CI ran for the first time on
this branch and failed — not on anything Gate 1.3 touched, but because three
other pre-existing `supabase/tests/*.test.sql` files (previously documented
here as "out of scope, unrelated") had already been fixed on `main` by three
commits made after this branch diverged, and this branch hadn't picked them
up yet. **Round 4b**: rebased this branch onto `main` to pick up those
fixes, and in doing so discovered that one of this report's own earlier
findings was itself wrong — the `taxonomy_id` "cross-tenant isolation gap"
was a test-harness false positive, not a real schema defect (full retraction
in §7/§9/§10). The gate now closes with **all five
`supabase/tests/*.test.sql` files passing** (zero known SQL test failures on
this branch), not just the two files Gate 1.3 itself touched.

---

## 1. What was built

A 16-value permit lifecycle status machine (`permit_status_enum`),
independent of the pre-existing AI-extraction pipeline `status` column,
layered onto `permit_applications`:

- Three role-gated tiers (`org` / `submission` / `jurisdiction_outcome`),
  enforced by `transition_permit_status()`, the single sanctioned write path.
- An append-only audit trail (`application_status_history`), auto-seeded on
  every fresh `permit_applications` INSERT via `seed_permit_status_history()`.
- A single coupling point between the two status machines: `permit_status`
  cannot advance to `'submitted'` until the pipeline's own `status` has
  independently reached `'submitted'`.
- Idempotent retries via `request_key` (`ON CONFLICT ... DO NOTHING`,
  collapsed from an earlier two-step check-then-insert — see §9).
- Optimistic concurrency on the transition UPDATE (`WHERE permit_status =
  v_from_status`, raises `40001` on a lost-update race — see §9).
- `project_id` added to `permit_applications`, with a backfill path for
  existing orphans, deliberately left nullable pending an application-layer
  fix (see §9 and `supabase/migrations_blocked/`).
- A feature flag (`PERMITFIELD_FF_APPLICATIONS`) declared ahead of any
  consumer, per this repo's existing flag pattern — gates nothing yet; the
  schema/RLS/RPC are live regardless of its value.

## 2. Files added

- `supabase/migrations/20260806000022_permit_status_machine.sql` (567 lines)
- `supabase/migrations/20260806000023_backfill_permit_application_project_id.sql` (136 lines)
- `supabase/migrations_blocked/20260806000023b_permit_application_project_id_not_null.sql` (50 lines) — deliberately outside `supabase/migrations/`, not applied by `supabase db reset`; see its own header for the promotion criteria.
- `supabase/tests/permit_status_machine.test.sql` (now 14 executable checks — see §7)
- `docs/STATUS_TRANSITIONS.md` (203 lines)
- `lib/permit-status/transitions.ts` (190 lines) — pure-TS mirror of the SQL transition/tier graph, no DB access, no call site yet
- `lib/permit-status/transitions.test.ts` (184 lines)

## 3. Files modified

- `docs/PERMISSIONS.md` (+62/-…) — added `application_status_history` as a `READ_ONLY_LOG` resource for every role, citation-backed by the table having no INSERT/UPDATE/DELETE RLS policy for `authenticated` at all.
- `lib/authz/index.ts` (+40/-…) and `lib/authz/index.test.ts` — same addition, code side.
- `lib/flags.ts` (+17) — `isApplicationsEnabled()`, following the existing `isEnabled(envVar)` pattern.
- `.env.example` (+3) — `PERMITFIELD_FF_APPLICATIONS=false`.
- `supabase/seed.sql` (+38/-…) — both fixture `permit_applications` rows now carry a real, non-`'backfill'` `project_id` supplied directly (round 2 fix, §9).

## 4. Migrations added

`20260806000022` and `20260806000023` (both listed in §2). No destructive or
data-lossy operations. Both are additive. `20260806000023` originally
included an unconditional `NOT NULL` step that would have broken the
branch's own `supabase db reset` and the live application-creation flow —
split out into the blocked, unapplied `23b` (§9, first bug found).

## 5. Feature flags added

`PERMITFIELD_FF_APPLICATIONS` (default `false`, `.env.example` line 37).
Gates nothing at runtime yet — no call site exists. The schema, RLS
policies, and `transition_permit_status()` RPC are live in the database
regardless of this flag's value, consistent with every other flag in
`lib/flags.ts`.

## 6. Security controls implemented

- RLS on `permit_applications`: unchanged, still `is_org_member`-scoped (pre-existing).
- RLS on `application_status_history`: `SELECT`-only via `is_org_member`, no INSERT/UPDATE/DELETE policy for `authenticated` at all — the only two writers are `seed_permit_status_history()` (trigger) and `transition_permit_status()` (RPC), both `SECURITY DEFINER`.
- Append-only enforcement on `application_status_history` via the pre-existing `forbid_update_delete()` trigger pattern (reused from `extractions`/`audits`/`audit_logs`) — holds even for `service_role` (verified, §7 check 6).
- Role-tier authorization inside `transition_permit_status()` (`org`/`submission`/`jurisdiction_outcome`), independent of transition-legality checking — verified a legal move can still be role-rejected (§7 check 3).
- **Column-level lockout on `permit_status`** — round 4, fixed and verified. The round-3 approach (`revoke update (permit_status) on permit_applications from authenticated`, layered on top of a pre-existing table-level `UPDATE` grant) was a no-op; see §7 check 13's history below for the full root-cause writeup. Replaced with: `revoke update on permit_applications from authenticated; grant update (status) on permit_applications to authenticated;` (migration `20260806000022`, near the end of the file). This revokes table-level `UPDATE` from `authenticated` entirely, then re-grants it back only on `status` — the one column with a legitimate direct-write call site (§7's enumeration). `permit_status` and every other column end up with no `UPDATE` grant at all, by construction rather than by an ineffective add-on revoke. Verified directly against a freshly reset database via `information_schema.table_privileges` and `information_schema.column_privileges` (not inferred): `authenticated` has zero table-level `UPDATE` rows and exactly one column-level `UPDATE` row (`status`); `service_role` retains full table-level `UPDATE`, unaffected, by design. Cross-verified via the test suite: `permit_status_machine.test.sql` check 13 now confirms the direct `UPDATE permit_status` is rejected (`insufficient_privilege`/42501), and a new adjacent assertion in the same check confirms `UPDATE status` still succeeds (the re-grant is scoped correctly, not accidentally broader or narrower).

## 7. Tests added + actual output

All output below is from an actual run, on this machine, against a real
local Postgres instance — not a prediction. Docker Desktop was found
already installed and (after being relaunched once, mid-session, when it had
stopped running) working; `npx supabase start` / `npx supabase db reset`
both succeeded; `psql` was run via `docker exec -i supabase_db_permitfield-os
psql -U postgres -d postgres` (no local `psql` binary exists on this
machine, so the container's own binary was used instead — functionally
identical to the documented `psql "$DB_URL"` invocation).

**Round-4 update: `supabase db reset` was run fresh again for this report**,
and every `supabase/tests/*.test.sql` file was re-run against the clean
database, after the privilege fix (§6) and two test-harness fixes (below)
landed in the working tree. The table below reflects that final run, not
the round-3 run.

**`supabase/tests/permit_status_machine.test.sql`** — 14 of 14 sections now
execute and pass (round 3 got 13 of 13 sections executing but check 13
failed for real; round 4's privilege fix makes check 13 pass, which
unblocks check 14):

| # | Check | Result |
|---|---|---|
| 1 | Fresh INSERT auto-seeds `NULL -> intake` history row | **PASS** |
| 2 | Transition legality (Check 1): legal edge succeeds, undeclared pair rejected `invalid_transition`/22023 | **PASS** |
| 3 | Role-tier authorization (Check 2), all three tiers, independent of legality | **PASS** |
| 4 | Cross-machine gate: `permit_status` can't reach `'submitted'` until pipeline `status` has | **PASS** |
| 5 | Idempotency: retried `request_key` is a silent no-op, no duplicate history row | **PASS** |
| 6 | `application_status_history` append-only vs UPDATE/DELETE, even for `service_role` | **PASS** |
| 7 | No direct INSERT path into `application_status_history` for `authenticated` | **PASS** |
| 8 | SELECT RLS boundary: Org B cannot read Org A's history | **PASS** |
| 9 | Org A owner can read its own history (9 rows) | **PASS** |
| 10 | `permit_status_tier()` classifies `intake`/`submitted`/`issued` correctly | **PASS** |
| 11 | `permit_status_transitions` globally readable by any `authenticated` user | **PASS** |
| 12 | Org B seed fixture carries a real, non-backfilled `project_id` | **PASS** |
| **13** | **Column-level lockout: direct `UPDATE permit_applications SET permit_status = ...` by `authenticated` is rejected with `insufficient_privilege`/42501; a same-check assertion also confirms `UPDATE status` (the re-granted column) still succeeds** | **PASS** (round 3: FAIL — the UPDATE succeeded with no error) |
| 13b | `transition_permit_status()` (SECURITY DEFINER) still writes `permit_status` successfully via the RPC after the column-level revoke — proves the revoke targets direct writes only, not the sanctioned RPC path | **PASS** — added in round 4; see the test-harness note below for why the target status changed from `'issued'` to `'closed'` |
| 14 | `backfill_orphaned_application_projects()`, 2-orphan case and 11-orphan safety-valve case | **PASS** — reached and executed for the first time this session (round 3 never got past check 13's transaction abort) |

**Round-4 test-harness fix (second one found in this file):** the RPC check
above originally targeted `'issued'`, written when fixture app A was assumed
to still be at `'approved'`. By the time this check runs, check 5
(idempotency, earlier in the same file) has already driven app A from
`'approved'` to `'issued'` via a real `transition_permit_status()` call,
making `'issued' -> 'issued'` an illegal self-transition
(`invalid_transition`). Retargeted to `'closed'`, verified directly against
`permit_status_transitions` that `issued -> closed` is a legal edge and that
`permit_status_tier('closed')` is still `'jurisdiction_outcome'` (matching
the `permit_coordinator` role already used in that check, so the check still
exercises the same role tier it always did). This is a test-harness defect
in a Gate 1.3 deliverable file, fixed under the same standing authorization
as the round-3 cleanup-bug fix ("whatever's cleanest, just make the
remaining checks runnable").

**Root cause of round 3's check 13 failure** (kept here for the record —
fixed in round 4, §6), confirmed by querying
`information_schema.table_privileges` directly against the live database
(not inferred):

```
grantee        | privilege_type
authenticated  | UPDATE     <- table-level, from 20260806000011_grants.sql:15
```

`authenticated` holds table-level `UPDATE` on `permit_applications`
(`grant select, insert, update, delete on permit_applications to
authenticated;`, `supabase/migrations/20260806000011_grants.sql:15`).
PostgreSQL privilege checks are `table-level OR column-level` — a
column-level `REVOKE UPDATE (permit_status) ... FROM authenticated` does not
subtract from a pre-existing table-level `GRANT UPDATE` covering every
column. The revoke in `20260806000022` (line ~579) is a no-op against the
actual privilege model. `applicant_contractor` — the lowest client-facing
role tier — can still run `update permit_applications set permit_status =
'closed' where id = ...` directly, bypassing `transition_permit_status()`
and every check inside it (legality, role tier, the cross-machine gate,
idempotency, audit-trail seeding), with no error and no trace in
`application_status_history`.

**Column-privilege enumeration** (requested explicitly, gathered by
exhaustive `grep -rn` for every `.from('permit_applications')` call site
across `app/` and `lib/`, cross-checked by reading each call site's actual
payload — not test/migration files):

*Full column list* (`permit_applications`): `id, org_id, contractor_id,
permit_type_id, project_title, project_address, status, estimated_job_value_cents,
currency_code, created_at, updated_at, permit_status, project_id,
permit_number, decision_date, decision_document_id`.

| Column | Written directly by `authenticated`-role app code? | Where | Legitimately user-writable? | Same bypass risk as `permit_status`? |
|---|---|---|---|---|
| `org_id` | INSERT only | `app/(app)/applications/new/actions.ts:79-88` | Yes, at creation only | No — no post-creation write path exists |
| `contractor_id` | INSERT only | same | Yes, at creation only | No |
| `permit_type_id` | INSERT only | same | Yes, at creation only | No |
| `project_title` | INSERT only | same | Yes, at creation only | No |
| `project_address` | INSERT only | same | Yes, at creation only | No |
| `estimated_job_value_cents` | INSERT only | same | Yes, at creation only | No |
| `status` (pipeline) | INSERT (`'draft'`) + UPDATE | INSERT: `app/(app)/applications/new/actions.ts:86`. UPDATE: `app/api/applications/[id]/submit/route.ts:41-44` (`'submitted'`), `app/api/applications/[id]/confirm-review/route.ts:91-94` (`'reviewed'`) | Yes — this is the pipeline's own, pre-existing, intentionally-direct-write column | **Yes, in principle** — same table-level grant covers it; nothing today validates that a caller updating `status` has the right role either. Out of scope for Gate 1.3 (pre-existing pipeline column, not part of this gate's status machine), flagged here since it shares the identical privilege gap. |
| `permit_status` | **Never**, by any app code | — (only via `transition_permit_status()`, which no call site invokes yet — `lib/permit-status/transitions.ts:20` states explicitly it has no call site and does not mutate anything) | No — the entire point of this gate is that this column is RPC-only | **Yes — this is check 13's finding** |
| `project_id` | Never | — | No, not yet (backfill/migration-only today) | N/A — never written by `authenticated` |
| `permit_number` | Never | — | No | N/A |
| `decision_date` | Never | — | No | N/A |
| `decision_document_id` | Never | — | No | N/A |
| `currency_code` | Never (defaults `'CAD'`) | — | No | N/A |
| `id`, `created_at`, `updated_at` | Never (defaults/PK) | — | No | N/A |

Backend/system writes (Inngest functions `extract.ts`, `audit.ts`,
`generate-pdf.ts`, all via `service_role`, not `authenticated`) only ever
touch the pipeline `status` column, confirming the migration's original
comment claim on that specific point was accurate. `service_role` keeps
table-level UPDATE by design (bypasses RLS already; out of scope).

**Net finding for the eventual revoke/grant fix**: no application code
today writes `permit_status`, `project_id`, `permit_number`,
`decision_date`, or `decision_document_id` directly — the only columns
`authenticated` app code legitimately writes directly are the six INSERT-only
columns plus `status`. A correct fix needs to revoke table-level `UPDATE`
from `authenticated` and re-grant column-level `UPDATE` only on `status`
(the only column with a legitimate direct-UPDATE call site) — leaving
`permit_status` (and every other column) with no `UPDATE` grant at all,
closing this gap by construction rather than by an ineffective add-on
revoke.

**Round-4 implementation and verification.** The user specified the exact
model matching this finding: `revoke update on permit_applications from
authenticated; grant update (status) on permit_applications to
authenticated;`. Implemented in migration `20260806000022` (replacing the
round-3 no-op revoke), and verified directly against a freshly reset
database, not inferred from the migration text:

```
-- information_schema.table_privileges, table_name = 'permit_applications', privilege_type = 'UPDATE'
   grantee    | privilege_type | is_grantable
--------------+----------------+--------------
 postgres     | UPDATE         | YES
 service_role | UPDATE         | NO
(2 rows)                                          -- authenticated: absent, i.e. no table-level UPDATE at all

-- information_schema.column_privileges, same table, privilege_type = 'UPDATE', grantee = 'authenticated'
    grantee    | column_name | privilege_type
---------------+-------------+----------------
 authenticated | status      | UPDATE
(1 row)                                           -- the only column, the only grant
```

`service_role` keeps full table-level `UPDATE` (unaffected, by design —
already bypasses RLS). This matches the fix's intent exactly: `authenticated`
has column-level `UPDATE` on `status` only, and no table-level `UPDATE` at
all.

**Test-harness fix made in this session** (the file is a Gate 1.3
deliverable, so this is a deliverable defect, not a footnote): the original
check 1's cleanup line, `delete from permit_applications where id =
new_app_id;`, cascades into `application_status_history` via FK, which is
append-only and rejects the DELETE — aborting the whole file's transaction
before checks 2–14 ever ran. This bug was **pre-existing in the original
base commit `6077d9f`**, confirmed via `git show
6077d9f:supabase/tests/permit_status_machine.test.sql` — unrelated to the
`b00a89e` fixes. Fixed by giving the check-1 fixture row a real `project_id`
(so it's never counted as an orphan by check 14's invariant assertion) and
removing the DELETE entirely (the whole file already runs inside one
`begin;`/`rollback;` transaction, so the row never persists past the run
regardless).

**Other pre-existing `supabase/tests/*.test.sql` files**, run for context:

- **`tenant_isolation.test.sql` — regressed by the round-4 privilege fix, then
  fixed. This file is NOT a Gate 1.3 deliverable, but the round-4 privilege
  fix broke it as a side effect, so the fix is documented here.** Its
  cross-tenant UPDATE probe (line ~56-58) used to `set project_title =
  'HACKED'` — `project_title` is INSERT-only per §7's enumeration, so once
  `authenticated` lost table-level `UPDATE`, that statement failed with
  `permission denied for table permit_applications` (a permission-layer
  error) instead of the RLS row-visibility failure (0 rows affected) the
  check exists to prove — a different failure mode than what the test was
  designed to assert, not a security regression itself. Per instruction,
  **not silently patched**: found, root-caused, and reported with the
  regression's exact mechanism before any fix was made. The user then
  specified the exact retarget (`status` instead of `project_title` — "same
  RLS proof, legitimate column"), which was implemented and re-verified: all
  8 checks now **PASS** against the freshly reset database, round-4 privilege
  fix included.

**Round-4b update: this branch was rebased onto `main`**, which had, in the
interim, picked up three commits (`4adb1fc`, `e3e1fda`, `f9015da`) fixing the
exact defects in `audit_logs.test.sql`, `jurisdiction_sources.test.sql`, and
`lifecycle_intake.test.sql` that earlier drafts of this report described as
"pre-existing, out of scope." Post-rebase, all three now pass:

- `audit_logs.test.sql`, `jurisdiction_sources.test.sql` — the `raised_at`
  fixture typo (not a real `auth.users` column) is fixed on `main`
  (`4adb1fc`); `jurisdiction_sources.test.sql` also had two assertions fixed
  (`e3e1fda`, `f9015da`) that wrongly expected a silent zero-row/zero-affected
  result where Postgres actually denies at the permission layer before RLS
  runs (no table-level grant at all for `anon`/no DELETE grant for
  `authenticated`) — both now accept either valid proof. **PASS**, both files.
- `lifecycle_intake.test.sql` — **PASS**, including the `taxonomy_id`
  cross-org check. **Retraction:** earlier drafts of this report (§7/§9/§10,
  as originally written) stated `projects.taxonomy_id` had "no composite
  `(org_id, taxonomy_id)` FK" and called this "a real cross-tenant isolation
  gap in migration `20260806000019`... deserves its own gate." **This was
  wrong.** The composite FK has always existed —
  `supabase/migrations/20260806000019_lifecycle_intake_properties_clients_taxonomies.sql:164`:
  `foreign key (org_id, taxonomy_id) references taxonomies (org_id, id)`,
  identical in shape to `contractor_id`/`client_id`/`property_id`'s FKs on the
  same table. The apparent "FAIL" was a test-harness defect fixed by `main`'s
  `4adb1fc`: the test looked up org B's `taxonomy_id` *after* switching to
  org A's JWT claims, so RLS silently returned `NULL` for that lookup, and
  under `MATCH SIMPLE` a `NULL` in a composite FK column exempts the whole
  constraint from enforcement — the insert "succeeding" proved nothing about
  the schema, only that the test's own lookup had already failed silently.
  Verified directly: ran `main`'s corrected version of this file against this
  branch's schema (which had not changed) and got "PASS: cross-org
  taxonomy_id on projects rejected by composite FK" before the rebase was
  even done, then again after the rebase with the file now natively part of
  this branch. **Earlier testing appeared to show a cross-tenant `taxonomy_id`
  gap; this was a test-harness defect, not a schema defect. The composite FK
  is correctly implemented. Retracted** — no follow-up gate is needed for
  this; it should not have been opened as a finding in the first place.

**Full-suite final state (post-rebase, this report), all five files re-run
against one freshly reset database in sequence:** `audit_logs` 9/9 PASS,
`jurisdiction_sources` 15/15 PASS, `lifecycle_intake` 13/13 PASS (retraction
above), `permit_status_machine` 14/14 PASS, `tenant_isolation` 8/8 PASS —
**all five files pass, zero known failures remaining** in
`supabase/tests/*.test.sql` as of this branch, post-rebase.

**`lib/permit-status/transitions.test.ts`** (vitest, no DB): part of the 249
passing tests below.

## 8. Typecheck/lint/build results

Round 3 results (`npx vitest run` 6 files/249 tests, `npx tsc --noEmit`,
`npx eslint .`, `npx next build`, all clean) are unchanged by round 4 — the
round-4 fix is entirely SQL-side (a migration's grant statements and two
`.test.sql` files), touching nothing `tsc`/`eslint`/`next build` evaluate.
Re-confirmed in round 4, actual output, on this branch with all round-4
fixes applied but not yet committed at time of running:

- `npx vitest run` → **6 test files, 249 tests, all PASS.** (re-run in round 4)
- `npx tsc --noEmit` → **0 errors.** (re-run in round 4)
- `npx eslint .` → **0 errors.** (re-run in round 4)
- `npx next build` → round 3: **succeeded**, compiled in 624ms, typechecked in 1021ms, 12 routes generated (2 static, 10 dynamic), no errors or warnings besides an unrelated Turbopack notice about `package-lock.json` living outside the git root. Not re-run standalone in round 4 (no application code changed since round 3, and `tsc --noEmit` — re-run above — already covers the typecheck surface `next build` would additionally exercise).

## 9. What is NOT done / stubbed / untested

- **Round-4 update: the column-level lockout on `permit_status` is now implemented and verified** (§6, §7 check 13/13b) — this bullet described the gate's central open item through round 3; it is resolved as of the round-4 commit this report is bundled with. `transition_permit_status()` enforces legality/role/cross-machine rules for callers who go through it, and a direct `UPDATE permit_status` from `authenticated` is now rejected at the grant layer (`insufficient_privilege`/42501), confirmed both by a live `information_schema` query and by the test suite.
- **No application code calls `transition_permit_status()` yet.** `lib/permit-status/transitions.ts` is a pure client-side mirror with no DB access and no call site (states this explicitly in its own header). The status machine is fully live in the database and fully unreachable from the product today — by design (`PERMITFIELD_FF_APPLICATIONS` gates a consumer that doesn't exist yet), but worth stating plainly rather than implying UI coverage exists.
- **Concurrency and idempotency guards are code-reviewed and single-transaction tested, not exercised under real concurrent connections.** Check 5 (idempotency) and the file's own header (item 11) both note this: the `request_key` `ON CONFLICT` race and the optimistic-concurrency `40001` guard are correct by inspection and pass under sequential single-connection test calls, but this file does not simulate genuine concurrent sessions racing each other.
- **`supabase/migrations_blocked/20260806000023b` is unapplied by design**, waiting on `createApplicationAction` being updated to supply `project_id` before the `NOT NULL` step can be promoted into `supabase/migrations/`. Not part of this gate's live schema.
- **Round-4 update: `backfill_orphaned_application_projects()`'s test coverage ran and passed this session** (§7 check 14) — round 3 left this unverified because check 13's transaction abort blocked it; round 4's privilege fix unblocked it, and both the 2-orphan and 11-orphan safety-valve cases now execute and pass, recorded in this report from an actual run, not the earlier unreported round-2 ad hoc pass.
- Three bugs fixed in round 2 (commit `b00a89e`, before this report) are execution-verified only indirectly: the NOT NULL split and seed.sql project_id fix are directly confirmed (§7 — `db reset` completes without error). The idempotency `ON CONFLICT` fix and the optimistic-concurrency `40001` guard are confirmed only via check 5's sequential pass and code review, not via genuine concurrent load (see the bullet above).
- **Retraction, cross-referenced from §7:** earlier drafts of this report listed a `projects.taxonomy_id` cross-tenant isolation gap as a real, confirmed defect requiring its own future gate. That was wrong — see §7's "Round-4b update" for the full retraction. Nothing further is owed on this item; it is not carried forward as an open task.

## 10. Known limitations and risks

- **The column-level lockout gap (§6/§7 check 13) is fixed as of round 4** — no longer a live risk on this branch. Kept here as a historical note: through round 3, any `authenticated` org member could bypass every rule `transition_permit_status()` enforces via a raw UPDATE; round 4's revoke/grant fix (§6) closes that path at the privilege layer, verified both directly (`information_schema`) and via the test suite.
- **The pipeline `status` column shares the same underlying privilege architecture** as `permit_status` did before round 4 — it now has an *intentional* column-level `UPDATE` grant (the round-4 fix's re-grant target), and it has a real, in-use direct-UPDATE call site (`submit`/`confirm-review` routes), but nothing validates that the caller updating `status` holds the right role for that specific transition (e.g. nothing stops a plain `member` from directly setting `status = 'submitted'` outside the normal submit flow, the way `transition_permit_status()` enforces role tiers for `permit_status`). Out of scope for this gate — flagged for awareness, not a Gate 1.3 defect since it predates this gate and nothing in this gate weakened it further; the round-4 fix only made this column's grant *narrower* (column-level instead of table-level), not role-aware.
- **`main` does not yet contain `PHASE_0_FINDINGS.md` at the same content/location as this branch** (surfaced incidentally while diffing this branch against `main` for this report) — not investigated further, out of scope for a Gate 1.3 report; noting it so it isn't lost.
- **Retraction, cross-referenced from §7:** see §7's "Round-4b update" and §9's retraction bullet above — the `taxonomy_id` cross-tenant gap previously listed here as a known limitation/risk was a test-harness false positive, not a real risk. Removed from this section; not carried forward.
- **Superseded, round-4b:** an earlier draft of this bullet said the branch was "still on a single local machine with no remote." That is no longer accurate — `origin` (`https://github.com/ren206-png/permitfield-os`) already existed with `main` pushed before this gate's work began, the round-4 commit was pushed to a feature branch on it, and this branch has since been rebased onto `main` (picking up three unrelated pre-existing-bug fixes, §7) and is being re-pushed. `stash@{0}`'s local-only redundancy caveat no longer applies now that commits exist on a remote; it is safe to consider dropping per the original standing instruction ("once the branch has been pushed somewhere off this machine"), though it has not been dropped as part of this report.

## 11. Adversarial self-check

1. **Would this pass a real security review as-is, as of round 4?** Yes, on the specific point round 3 failed on: §6/§7 check 13/13b confirm the privilege-bypass gap is closed, verified independently via both a live `information_schema` query and the test suite, not just by reading the migration's new comment. It would NOT pass review with zero comment — §10's `status`-column role-awareness gap is real, pre-existing, and explicitly out of scope, not swept under this report's "PASS" framing.
2. **Was the "verified empirically" claim in the original migration comment ever true?** No — confirmed false at the time it was written (round 2/3). Corrected in round 3 to state the actual defect and cite the not-yet-final report. Round 4 replaced that defect-acknowledging comment with a description of the actual working fix, this time citing verification that has genuinely been run (§6, §7) — the same discipline applied twice, once to remove a false "it works" claim, once to add a true one.
3. **Does fixing check 1's test-harness bug hide or paper over a real defect, or does it only unblock detection of one?** Only the latter — verified by tracing the fix (giving the fixture row a `project_id`, removing an unnecessary DELETE inside a transaction that rolls back anyway) has zero effect on what any of the 13 checks actually assert; it only lets checks 2–14 run instead of aborting at check 1's cleanup.
4. **Is the column-privilege enumeration in §7 actually exhaustive, or just "everywhere I thought to look"?** Exhaustive by construction — an independent search agent grepped every `.from('permit_applications')` call site across `app/` and `lib/` (18 total sites, all listed), and this was spot-checked directly by reading `createApplicationAction`, both API routes' exact `.update()` payloads, matching the agent's findings verbatim before trusting them.
5. **Could the same table-level-grant-defeats-column-revoke gap exist anywhere else in this codebase, undetected?** Not checked. This report only enumerates `permit_applications`. Any other table using a column-level `REVOKE` layered on a pre-existing table-level `GRANT` (if one exists elsewhere in this schema) would have the identical defect. Flagged as an open question, not verified either way.
6. **Now that the privilege model is actually fixed (round 4), is "no application code writes `permit_status` yet" still a relevant caveat?** Less so, but worth keeping: the privilege fix means there is no longer an open path at all for `authenticated`, regardless of whether application code exists — a compromised session token or misconfigured client now gets a hard `insufficient_privilege` error, not a silent successful bypass. The "no call site yet" fact now only describes product incompleteness (the RPC has no consumer), not a security gap.
7. **Did fixing the migration's false comment introduce a new false claim?** Checked directly: the replacement text was written after independently confirming, via a live `information_schema.table_privileges` query against the actual reset database (not memory or assumption), that `authenticated` holds table-level UPDATE, and after correcting an initial citation error (first draft cited "circa 20260806000002"; verified via grep against `20260806000011_grants.sql:15` and corrected before this report was written).
8. **Are the vitest/tsc/eslint/build "all green" results actually about this gate, or do they just not touch the parts that are broken?** They don't touch it — check 13's failure is a Postgres privilege-model gap, invisible to TypeScript, ESLint, or a Next.js build; none of those tools evaluate SQL grants. "All green" here means the TS-side mirror and the rest of the app are unaffected, not that the gate is secure.
9. **Was section 14 (backfill function) actually run this round, or is this report reusing an old claim?** Run this round, fresh: `npx supabase db reset` then the full test file, both cases (2-orphan, 11-orphan safety valve) observed passing in this session's own terminal output, not carried over from the round-2 ad hoc pass this report previously (correctly) refused to credit.
10. **Does this report overstate what's fixed relative to what's merely found, now that round 4 claims things are fixed?** Every "PASS" claim in §7's round-4 table and §6's privilege-state claim is backed by output pasted or described from an actual command run in this session (`information_schema` queries, `psql` test-file runs, `vitest`/`tsc`/`eslint`), not from re-reading the migration's own comment and trusting it — the same standard applied to catching round 3's false claim is applied to round 4's true one. The one place this report is deliberately conservative rather than declaring total victory: §10 still flags the `status`-column role-awareness gap as real and unresolved, and §7 still lists three unrelated pre-existing test files as still failing, rather than letting round 4's fix read as "everything is now green."
11. **Did fixing `tenant_isolation.test.sql`'s probe column introduce a weaker test than the original?** Checked: `status` is a real, legitimately-used column (unlike a column that might be UPDATE-disabled for unrelated reasons), and the check still asserts the same thing the original did — a cross-tenant UPDATE from `authenticated` affects 0 rows because RLS filters the target row out of the update's own visibility, not because of a permission error. The retarget makes the check exercise RLS row-visibility specifically, which is closer to the check's stated intent ("RLS filters the target row out, it does not error") than the original `project_title` version was, since `project_title` now fails at the permission layer before RLS is ever evaluated — a fact called out directly in the test file's own updated comment.
12. **Was the privilege-fix verification (§6's `information_schema` output) run against the exact code that will be committed, or against some earlier draft?** Run last: `npx supabase db reset` was executed fresh immediately before the `information_schema` queries and the full five-file test run in this report, against the working tree as it stands right now, uncommitted — the same working tree about to be committed. No verification in this report is against a since-edited version of any file.

## 12. Manual QA checklist

Not applicable in the way a UI-facing gate would need — `PERMITFIELD_FF_APPLICATIONS` gates no UI yet (§9), so there is no product surface to manually click through. The equivalent manual verification for this gate is the SQL test run in §7, which is what this report substitutes for a UI checklist. Once an application-layer consumer of `transition_permit_status()` exists in a later gate, a real manual QA checklist (attempt each of the 16 statuses' legal/illegal transitions as each of the 3 role tiers, confirm the cross-machine gate blocks premature submission in the UI, confirm history is visible and not editable) belongs in that gate's report, not this one.
