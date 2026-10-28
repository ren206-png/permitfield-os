# Gate 6 — LLM Permitting Copilot — Status

Running status for Gate 6 (master prompt v2, Oct 26). Findings: `GATE_6_FINDINGS.md`.

## Decisions (Ren, 2026-10-28)

| # | Decision |
|---|---|
| D1 | Nationwide-capable schema; verified content AB/BC/ON first |
| D2 | Integer minor units, currency + rounding rule on each fee-schedule version |
| D3 | Gate number 6 |
| D4 | Full-text retrieval only; existing vector columns left untouched |
| D5 | Location resolution by manual confirmation only |
| D6 | Inngest for background jobs |
| D7 | Extend existing requirements, readiness, extraction and retrieval; no rebuilds |
| D8 | Copilot is staff-only; lint boundary against the client-portal bridge (6.4) |
| D9 | Squash merges (repo convention), **branches kept** (never deleted) |
| B1 | Claude drafts rules from official sources; Ren approves; Calgary, Vancouver, Toronto first |
| Q1 | Copilot model `claude-sonnet-5-5`; the extraction model is unchanged |
| Q2 | Standalone typecheck added to CI (6.1) |
| Q3 | Permit-to-work dropped from Gate 6 |
| Q4 | `npm ci` run in the local checkout (2026-10-28) |

---

## 6.1 — Foundation schema

**Branch:** `feat/permitfield-6.1-foundation-schema`.

**Approval:** `APPROVED: PHASE 6.1` (Ren, 2026-10-28).

### What changed

**`supabase/migrations/20260806000091_copilot_catalogue_foundation.sql`**
- Adds six global catalogue tables:
  - `source_revisions`;
  - `source_revision_reviews`;
  - `coverage_records`;
  - `rule_set_versions`;
  - `rule_set_version_items`;
  - `fee_schedule_versions`.
- Adds two enums: `source_access_scope` and `fee_rounding_rule`.

**`supabase/migrations/20260806000092_copilot_project_foundation.sql`**
- Adds three org-scoped tables:
  - `project_facts`;
  - `project_requirement_snapshots`;
  - `copilot_tool_invocations`.
- Adds four enums: `project_fact_provenance`, `project_fact_state`, `requirement_applicability` and `copilot_tool_status`.

**`supabase/tests/copilot_foundation.test.sql`**
- A new SQL test file with 15 assertion blocks.

**`.github/workflows/ci.yml`**
- A new `npx next typegen && npx tsc --noEmit` step in `build-and-test`.

**Not changed:** no existing table, column, policy, grant or function. No flag was added, because nothing is user-reachable yet.

### Requirement → code → verification

| Requirement (master prompt) | Code | Verified by |
|---|---|---|
| §7 immutable source revisions with hash, effective interval, supersession (O4) | `source_revisions` (091) | test: control insert; bad-hash and inverted-window CHECKs |
| §7 review state separate from content | `source_revision_reviews` (091), reusing `jurisdiction_source_verification_status` | test: control insert; owner denied |
| §6 coverage per authority / permit family / scope / period (O5) | `coverage_records` (091), with `verified` requiring a source revision | test: `verified` without source → `check_violation` |
| §7 publication creates an immutable rule-set version | `rule_set_versions` and `rule_set_version_items` (frozen `requirement_snapshot`) (091) | test: control insert; append-only |
| §16 / D2 fees: minor units, currency, rounding, source required | `fee_schedule_versions` (091) | test: lower-case currency → `check_violation`; missing source → `not_null_violation` |
| §8 append-only project facts with provenance and review state | `project_facts` (092) | test: insert + superseding confirmed correction; confirmed without reviewer → `check_violation` |
| §9 three-valued outcome; `not_applicable` needs an evaluated rule | `project_requirement_snapshots` (092) | test: `not_applicable` without rule set → `check_violation` |
| §12 tool invocation log | `copilot_tool_invocations` (092) | test: failed without message → `check_violation`; member cannot read |
| §1.8 tenant isolation from the session, not from arguments | RLS via `is_org_member` / `can_read_ai_ledger`; composite FK `(org_id, project_id)` | test: cross-org read 0 rows with control; cross-org insert 42501; mismatched project 23503; forged author 42501 |
| §1.7 append-only ledgers | no UPDATE/DELETE grants + `forbid_update_delete()` triggers | test: 42501 for authenticated and service_role on all 9 tables; trigger fires for postgres on a real row of all 9 |
| TRUNCATE bypasses RLS and triggers | `revoke all` then minimal grants | test: no TRUNCATE for anon/authenticated/service_role on all 9; control: owner has it |
| Q2 standalone typecheck | `ci.yml` step | CI log on this PR |

### Test evidence (local, 2026-10-28, after `supabase db reset`)

| Suite | Result |
|---|---|
| `npm run test:sql` | **`===== summary: 47 passed, 0 failed (of 47 files) =====`**. Baseline was 46 files on `55df0b5`: +1 file and +15 PASS notices, all from `copilot_foundation.test.sql` (log lines `:75` to `:448`) |
| `npm run test:sql:client-portal` | `2 passed, 0 failed (of 2 files)`, unchanged |
| `npm test` | `64 passed (64)` files, `674 passed (674)` tests, unchanged |
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean in CI. Locally it reports duplicate-identifier errors **only** from iCloud-created `.next/types/* 2.ts` copies, because the checkout lives under the iCloud-synced Desktop. That's environment noise, not code |
| `npm run test:live` | locally 9 of 37 fail in `lib/bridge/client-portal.live.test.ts` (`link_unavailable`). **The same 9 fail on unmodified `origin/main`** (verified in a separate worktree on a fresh `db reset`), so it's pre-existing and environment-specific. CI ran this suite 37/37 on `55df0b5` (run 40197988522, log line `:3034`) |

### Production pre-check (read-only, 2026-10-28)

- Postgres 17.6, so `unique nulls not distinct` is supported.
- All five helper functions exist: `is_platform_admin`, `is_org_member`, `can_read_ai_ledger`, `forbid_update_delete`, `account_deletion_in_progress`.
- No name clash with the new tables.
- The last applied migration is `20260806000090`.
- Merging applies 091 and 092 via `deploy-migrations.yml`.

### Rollback

Each migration's header carries its rollback SQL (`drop table` / `drop type` in reverse order). Both are only valid while no later object references the new tables. As of 6.1, none does.

### Introduced, not yet wired (§1.13)

| Object | Owner |
|---|---|
| `source_revisions`, `source_revision_reviews`, `coverage_records`, `rule_set_versions`, `rule_set_version_items` | 6.3 (review and publication console), 6.2 (rule engine reads rule sets) |
| `fee_schedule_versions` | 6.5 (fee engine) |
| `project_facts` | 6.4 (fact extraction review); 6.2 (engine reads facts) |
| `project_requirement_snapshots` | 6.2 (engine writes snapshots) |
| `copilot_tool_invocations` | 6.4 (tool registry) |

### §19 adversarial checks

| Check | Result |
|---|---|
| Vacuous test | Every expected failure is caught by a specific SQLSTATE, never `when others`. Every 0-row read is paired with a control. See the finding below about 8 existing vacuous assertions. |
| Green badge, zero tests | Counts quoted from the log (47 files; 15 new PASS lines), not the badge |
| Dead helper | All new tables are listed under "introduced, not yet wired", each with an owner |
| Flag that gates nothing | No flag introduced in 6.1 |
| Model-trusted scope | Reads derive scope from `auth.uid()` (`is_org_member`, `can_read_ai_ledger`). Snapshot and tool-call writes are service-role only. The composite FK stops org/project mismatches |
| Float money | Fee amounts live as integer minor units inside `parameters`. The 6.5 engine will enforce a branded `MinorUnits` type |
| Squash merge | Per D9, squash is the accepted convention. Branches are kept |

### New findings (not fixed in 6.1, each needs Ren's call)

- **F1 — TRUNCATE on existing tables.**
  - In production, `anon` and `authenticated` hold TRUNCATE on **66 of 73** public tables, including `audit_logs`, `payments`, `extractions` and `application_status_history`. This comes from Supabase's default privileges, read-only query of 2026-10-28. TRUNCATE skips RLS and append-only triggers.
  - It isn't reachable today: both roles are NOLOGIN, PostgREST has no TRUNCATE, and the RPCs run fixed SQL. Still, it's the same class as the 2026-10-11 writable-view incident.
  - **Proposal:** a small hardening migration that revokes TRUNCATE from `anon` and `authenticated` on all public tables, and alters default privileges so new tables don't get it.
- **F2 — 8 vacuous assertions in existing SQL tests.**
  - The locations are `ai_jobs_ledger_human_reviews.test.sql:222`, `application_document_chunks.test.sql:140,151`, `audit_logs.test.sql:155,166` and `drawing_review_schema.test.sql:251,262,273`.
  - They print `PASS … (FAIL: authenticated was able to UPDATE …)`. The UPDATE/DELETE silently matched 0 rows under RLS, the block's own `raise exception 'FAIL…'` fired, and `when others` turned it into a PASS.
  - The protected property still holds, because there's no UPDATE/DELETE policy, but those assertions prove nothing.
  - **Proposal:** rewrite them with a SQLSTATE-specific catch and a row-count check, test-only.
- **F3 — local `test:live` environment** (above). This is a local-only issue to diagnose separately. CI is green.

**Resolution (Ren: "merge 87 and do F1 and F2"):** F1 and F2 were fixed in #88, merged 2026-10-28.
- F1: migration `20260806000093_public_roles_no_truncate.sql` revokes TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from `anon` and `authenticated` on every public table and in the default privileges. `public_roles_no_truncate.test.sql` checks every table, a table created after the migration, and a real TRUNCATE attempt on `audit_logs` against a probe row.
- F2: the 8 assertions now catch `insufficient_privilege` / `raise_exception` only, check `row_count`, and confirm as `postgres` that the row is unchanged.
- SQL suite: 48/48 files, 524 PASS, 0 vacuous.
- F3 remains open (local only).

---

## 6.2 — Deterministic rule engine and manual authority resolution

**Approval:** `APPROVED: PHASE 6.2` (Ren, 2026-10-28). No migration in this phase: it reads and writes the 6.1 tables only.

### What changed

| File | Purpose |
|---|---|
| `lib/requirements/rules/condition.ts` | Condition language: a Zod-validated JSON tree of comparisons (`eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`) combined with `all` / `any` / `not`. Strict objects, snake-case dotted fact keys, at most 8 levels deep and 64 nodes. No expressions, regex or code. It is evaluated with three-valued (Kleene) logic. A comparison is `unknown` when the fact is missing, awaiting confirmation, the wrong type, or in a different unit. There is no unit conversion. |
| `lib/requirements/rules/facts.ts` | Turns `project_facts` rows into the values the engine may use. Only `confirmed` rows count. A row is superseded only by a *confirmed* correction. A key with only proposals is `awaiting_confirmation`. A key with only rejections is missing. |
| `lib/requirements/rules/rule-set.ts` | Validates a published rule set (invalid snapshot, duplicate requirement, unknown prerequisite, dependency cycle) and evaluates it to `applicable` / `not_applicable` / `unknown`, with a reason, a comparison trace and the fact ids used. `summarizeEvaluation` gives counts out of the full total, plus why each unknown is unknown. |
| `lib/requirements/rules/run.ts` | `evaluateApplicationRequirements(applicationId)` does RLS-scoped reads (application, facts, latest rule set, live catalogue) and then a service-role insert of one `project_requirement_snapshots` row per requirement. Gated by `PERMITFIELD_FF_COPILOT_RULES`. |
| `lib/jurisdictions/resolve-authority.ts` | `resolveAuthorityManually`, per D5: exact, normalised province + municipality match only. Even a single match needs the user's confirmation. A confirmation that contradicts the typed location is refused. Several authorities are all surfaced. None goes to review. |
| `lib/flags.ts` | `isCopilotRulesEnabled()` (`PERMITFIELD_FF_COPILOT_RULES`, default off). |
| `lib/supabase/service-client.ts` | Exception 8: the snapshot insert. |

### Requirement → code → verification

| Requirement (master prompt) | Code | Verification |
|---|---|---|
| Conditions are data, never executed | `ConditionSchema` (strict, bounded) | `condition.test.ts`: unknown ops, extra keys (`code`), string expressions, empty lists, string-for-number and over-deep trees are all rejected |
| Missing facts propagate as unknown, never false | `evaluateCondition` Kleene `all`/`any`/`not` | `condition.test.ts`: missing / awaiting confirmation / type / unit cases; `not(unknown)`; all four Kleene cases. `rule-set.test.ts`: "a missing fact propagates as unknown" |
| Only confirmed facts are used | `resolveFacts` | `facts.test.ts`: proposed and rejected corrections never hide or replace a confirmed value |
| Cycle detection | `findCycles` (DFS) | `rule-set.test.ts`: a 3-node cycle and a self-cycle, each reported once with its path; an acyclic chain passes |
| `not_applicable` requires a published, valid rule set | `evaluateRuleSet` + the 6.1 CHECK constraint | `rule-set.test.ts`: across no-set, invalid-set, partial-set and evaluated-set scenarios, every `not_applicable` has coverage `published_rule_set` and reason `condition_not_met` |
| "No matching rule" is not "not required" | `not_in_rule_set`, `condition_not_encoded`, `no_published_rule_set`, `rule_set_invalid` | `rule-set.test.ts`, one test each |
| No invented precedence | Applicable item whose prerequisite does not apply gets a warning, not a resolution | `rule-set.test.ts` |
| Manual authority resolution, no guessing | `resolveAuthorityManually` | `resolve-authority.test.ts`: misspelt, nearby and wrong-province cities give `unsupported_scope`; exact match still needs confirmation; contradiction refused |
| Scope from the database, not arguments | `run.ts`: org/project from the RLS-visible application row; `applicationId` Zod-validated | Code review (see "not yet wired") |

### Test evidence (local, 2026-10-28)

- New: 4 files, 27 tests, all passing.
- Full unit suite: 68 files / 701 tests passing (6.1 baseline 64 / 674). The +4 / +27 is exactly the new files.
- `npx next typegen && npx tsc --noEmit`: clean. ESLint on the changed paths: clean.
- SQL suite not re-run: 6.2 adds no SQL.

### Introduced, not yet wired (§1.13)

| Object | Owner |
|---|---|
| `evaluateApplicationRequirements` (`run.ts`) | 6.4 (copilot UI / tool registry calls it). It has no unit test because it is I/O glue over the tested pure functions. Its first end-to-end check comes in 6.4, against a local DB with a published rule set |
| `resolveAuthorityManually` | 6.4 (project location step) |
| `PERMITFIELD_FF_COPILOT_RULES` | Gates `run.ts` only. Default off, not set in any environment |

### §19 adversarial checks

| Check | Result |
|---|---|
| Vacuous test | `not_applicable` invariant test also asserts the positive case (`scenarios[3]` is `not_applicable`), so it can't pass on an engine that never says "not applicable" |
| Green badge, zero tests | Counts quoted from the run (+4 files / +27 tests) |
| Dead helper | Both entry points are listed above with an owner |
| Flag that gates nothing | The flag gates `run.ts`, which has no caller yet. Stated plainly rather than claimed as live gating |
| Model-trusted scope | No model input in 6.2. Org/project come from the database, not the caller |
| Untyped DB client | `lib/supabase` has no generated `Database` type, so tsc does not check column names. `run.ts` columns were checked by hand against migrations 026, 091 and 092 |

### Corrections

- Dates in this file and `GATE_6_FINDINGS.md` had been written as 2026-10-29. Corrected to 2026-10-28, which matches the system clock and the GitHub run times.
