# GATE 1.3 REPORT — Permit Applications Status State Machine

Branch: `feat/permitfield-phase-1.3-permit-status-machine`
Commits covered: `6077d9f` (original), `b00a89e` (Gate 1.3 review round 2), plus
the uncommitted-as-of-this-report round-3 fixes described in §7/§9 below.
This is the first `§6 GATE <n> REPORT` written in this repo. Per explicit
instruction, Gates 1.0–1.2 are **not** retroactively documented here or
anywhere else — this report covers Gate 1.3 only.

**Framing, stated up front:** this is not a report of a clean gate. Automated
execution (the first time this branch's SQL has ever actually been run,
against a real Postgres instance under RLS) revealed a privilege-bypass
defect in the column-level lockout approach described in §6/§13 below. That
is Gate 1.3 working as intended — static review had already caught and fixed
three other real bugs (§9); this is a fourth, caught only because execution
finally became possible. The gate is not closing clean. It is closing with
one known, root-caused, unresolved defect, explicitly not silently patched.

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
- `supabase/tests/permit_status_machine.test.sql` (596 lines, now 13 executable checks — see §7)
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
- **Column-level lockout on `permit_status`** (`revoke update (permit_status) on permit_applications from authenticated`, migration `20260806000022` line ~579): **implemented, does not work.** See §13 in §7 and the full root-cause/remediation writeup in §7's subsection below. This is the gate's one open, unresolved security gap. The migration's own comment block previously claimed this was "verified empirically" — that claim was false (the verification had never been run) and has been corrected in the migration file itself, in this session, to instead state the defect plainly and cite this report.

## 7. Tests added + actual output

All output below is from an actual run, on this machine, against a real
local Postgres instance — not a prediction. Docker Desktop was found
already installed and (after being relaunched once, mid-session, when it had
stopped running) working; `npx supabase start` / `npx supabase db reset`
both succeeded; `psql` was run via `docker exec -i supabase_db_permitfield-os
psql -U postgres -d postgres` (no local `psql` binary exists on this
machine, so the container's own binary was used instead — functionally
identical to the documented `psql "$DB_URL"` invocation).

**`supabase/tests/permit_status_machine.test.sql`** — 13 of 13 sections now
execute (previously 1 of 13, blocked by a test-harness bug fixed in this
session, see below):

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
| **13** | **Column-level lockout: direct `UPDATE permit_applications SET permit_status = ...` by `applicant_contractor` is rejected with `insufficient_privilege`/42501** | **FAIL — the UPDATE succeeded with no error.** |
| 14 | `backfill_orphaned_application_projects()`, 2-orphan case and 11-orphan safety-valve case | **Not reached** — check 13's failure aborted the file's single outer transaction; every statement after it errors with "current transaction is aborted." |

**Root cause of check 13's failure**, confirmed by querying
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
revoke. Not implemented pending the user's explicit specification of the
grant model, per instruction.

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

**Other pre-existing `supabase/tests/*.test.sql` files**, run for context,
none touched by Gate 1.3:
- `tenant_isolation.test.sql` — all 8 checks **PASS**.
- `audit_logs.test.sql`, `jurisdiction_sources.test.sql` — both fail immediately on a literal fixture typo (`raised_at` is not a real `auth.users` column). Pre-existing, unrelated to this gate. Per instruction, **not fixed here** — already in scope for `prep/never-executed-test-fixes`, to be addressed there.
- `lifecycle_intake.test.sql` — a genuine, real FAIL: `org A project accepted a taxonomy_id belonging to org B`. `projects.taxonomy_id` has no composite `(org_id, taxonomy_id)` FK, unlike `contractor_id`/`client_id`/`property_id` on the same table, which do and correctly reject cross-org references. **Discovered but out-of-scope for Gate 1.3** — a real cross-tenant isolation gap in migration `20260806000019`, from an earlier gate. Per instruction, flagged here so it isn't forgotten, to be opened as its own gate with a composite-FK design, test coverage, and a data audit for any already-existing bad rows.

**`lib/permit-status/transitions.test.ts`** (vitest, no DB): part of the 249
passing tests below.

## 8. Typecheck/lint/build results

All run in this session, actual output, on this branch with the round-3
fixes (§7's test-harness fix, §6/§13's migration-comment fix) applied but
not yet committed at time of running:

- `npx vitest run` → **6 test files, 249 tests, all PASS.**
- `npx tsc --noEmit` → **0 errors.**
- `npx eslint .` → **0 errors.**
- `npx next build` → **succeeded**, compiled in 624ms, typechecked in 1021ms, 12 routes generated (2 static, 10 dynamic), no errors or warnings besides an unrelated Turbopack notice about `package-lock.json` living outside the git root.

## 9. What is NOT done / stubbed / untested

- **`permit_status` has no working write-time privilege enforcement below the RPC layer** (§7 check 13, §6). `transition_permit_status()` itself correctly enforces legality/role/cross-machine rules for callers who go through it, but nothing stops a direct UPDATE from any `authenticated` role today. This is the gate's central open item.
- **No application code calls `transition_permit_status()` yet.** `lib/permit-status/transitions.ts` is a pure client-side mirror with no DB access and no call site (states this explicitly in its own header). The status machine is fully live in the database and fully unreachable from the product today — by design (`PERMITFIELD_FF_APPLICATIONS` gates a consumer that doesn't exist yet), but worth stating plainly rather than implying UI coverage exists.
- **Concurrency and idempotency guards are code-reviewed and single-transaction tested, not exercised under real concurrent connections.** Check 5 (idempotency) and the file's own header (item 11) both note this: the `request_key` `ON CONFLICT` race and the optimistic-concurrency `40001` guard are correct by inspection and pass under sequential single-connection test calls, but this file does not simulate genuine concurrent sessions racing each other.
- **`supabase/migrations_blocked/20260806000023b` is unapplied by design**, waiting on `createApplicationAction` being updated to supply `project_id` before the `NOT NULL` step can be promoted into `supabase/migrations/`. Not part of this gate's live schema.
- **`backfill_orphaned_application_projects()`'s only test coverage did not run this session** (§7 check 14, blocked by check 13's transaction abort). It passed in an earlier, unreported ad hoc run during the round-2 review, but that is not a substitute for a real recorded result in this report — treat it as **unverified** until check 13 is fixed and the file runs end to end.
- Three bugs fixed in round 2 (commit `b00a89e`, before this report) are execution-verified only indirectly: the NOT NULL split and seed.sql project_id fix are directly confirmed (§7 — `db reset` completes without error). The idempotency `ON CONFLICT` fix and the optimistic-concurrency `40001` guard are confirmed only via check 5's sequential pass and code review, not via genuine concurrent load (see the bullet above).

## 10. Known limitations and risks

- **The column-level lockout gap (§6/§7 check 13) is a real, currently-live privilege gap on this branch**, not merely a documentation error — any `authenticated` org member can currently bypass every rule `transition_permit_status()` enforces via a raw UPDATE, if this branch were merged and deployed as-is today. It's mitigated only by the fact that no application code performs such a write yet and the feature flag gates the (nonexistent) UI — not by anything in the schema itself.
- **The pipeline `status` column shares the same underlying privilege architecture** (table-level grant, no column-level restriction) as `permit_status`, and today has a real, in-use direct-UPDATE call site (`submit`/`confirm-review` routes) with no column-level enforcement of its own. Out of scope for this gate — flagged for awareness, not a Gate 1.3 defect since it predates this gate and nothing in this gate weakened it further.
- **`main` does not yet contain `PHASE_0_FINDINGS.md` at the same content/location as this branch** (surfaced incidentally while diffing this branch against `main` for this report) — not investigated further, out of scope for a Gate 1.3 report; noting it so it isn't lost.
- This report, the fixes in `b00a89e`, and the round-3 fixes described in §7/§6 are **all on a single local machine with no remote.** Per standing instruction, nothing is pushed and the branch's only redundancy is the (intact, not yet dropped) `stash@{0}` plus this local commit history.

## 11. Adversarial self-check

1. **Would this pass a real security review as-is?** No. §6/§7 check 13 is a live privilege-bypass gap on the column this entire gate exists to protect. A reviewer who ran the test suite (as this session did, for the first time) would fail it on that basis alone.
2. **Was the "verified empirically" claim in the original migration comment ever true?** No — confirmed false. No execution environment existed when that comment was written; it asserted a result that had never been produced. Corrected in this session (migration `20260806000022`, comment block above line ~579) to state the actual defect and cite this report instead of a report that didn't exist yet.
3. **Does fixing check 1's test-harness bug hide or paper over a real defect, or does it only unblock detection of one?** Only the latter — verified by tracing the fix (giving the fixture row a `project_id`, removing an unnecessary DELETE inside a transaction that rolls back anyway) has zero effect on what any of the 13 checks actually assert; it only lets checks 2–14 run instead of aborting at check 1's cleanup.
4. **Is the column-privilege enumeration in §7 actually exhaustive, or just "everywhere I thought to look"?** Exhaustive by construction — an independent search agent grepped every `.from('permit_applications')` call site across `app/` and `lib/` (18 total sites, all listed), and this was spot-checked directly by reading `createApplicationAction`, both API routes' exact `.update()` payloads, matching the agent's findings verbatim before trusting them.
5. **Could the same table-level-grant-defeats-column-revoke gap exist anywhere else in this codebase, undetected?** Not checked. This report only enumerates `permit_applications`. Any other table using a column-level `REVOKE` layered on a pre-existing table-level `GRANT` (if one exists elsewhere in this schema) would have the identical defect. Flagged as an open question, not verified either way.
6. **Is "no application code writes `permit_status` yet" actually a mitigation, or does it just mean the gap hasn't been exploited yet?** The latter. It reduces today's blast radius to zero known call sites, not the actual privilege model. Anyone with direct DB/API access (a compromised session token, a misconfigured client, a future engineer unaware of the intended RPC-only contract) has an open path today.
7. **Did fixing the migration's false comment introduce a new false claim?** Checked directly: the replacement text was written after independently confirming, via a live `information_schema.table_privileges` query against the actual reset database (not memory or assumption), that `authenticated` holds table-level UPDATE, and after correcting an initial citation error (first draft cited "circa 20260806000002"; verified via grep against `20260806000011_grants.sql:15` and corrected before this report was written).
8. **Are the vitest/tsc/eslint/build "all green" results actually about this gate, or do they just not touch the parts that are broken?** They don't touch it — check 13's failure is a Postgres privilege-model gap, invisible to TypeScript, ESLint, or a Next.js build; none of those tools evaluate SQL grants. "All green" here means the TS-side mirror and the rest of the app are unaffected, not that the gate is secure.
9. **Was section 14 (backfill function) actually run this session, anywhere, even outside the main test file?** No. It is explicitly marked unverified in §9 rather than reusing an earlier, unreported ad hoc pass from the round-2 review — that earlier run is not in this report's evidence chain and should not be treated as current.
10. **Does this report overstate what's fixed relative to what's merely found?** Cross-checked against §9/§10: round 2's three fixes (NOT NULL split, idempotency, concurrency) are described with their actual verification depth (direct for the first, indirect/code-review for the other two) rather than uniformly "fixed." Check 13 is stated as failing, not as "found and being addressed" — no remediation has been committed yet, by design, pending the user's grant-model specification.

## 12. Manual QA checklist

Not applicable in the way a UI-facing gate would need — `PERMITFIELD_FF_APPLICATIONS` gates no UI yet (§9), so there is no product surface to manually click through. The equivalent manual verification for this gate is the SQL test run in §7, which is what this report substitutes for a UI checklist. Once an application-layer consumer of `transition_permit_status()` exists in a later gate, a real manual QA checklist (attempt each of the 16 statuses' legal/illegal transitions as each of the 3 role tiers, confirm the cross-machine gate blocks premature submission in the UI, confirm history is visible and not editable) belongs in that gate's report, not this one.
