# Gate 6 — LLM Permitting Copilot — Status

Running status for Gate 6 (master prompt v2, Oct 26). Findings: `GATE_6_FINDINGS.md`.

## Decisions (Ren, 2026-10-29)

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
| Q4 | `npm ci` run in the local checkout (2026-10-29) |

---

## 6.1 — Foundation schema

**Branch:** `feat/permitfield-6.1-foundation-schema`.

**Approval:** `APPROVED: PHASE 6.1` (Ren, 2026-10-29).

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

### Test evidence (local, 2026-10-29, after `supabase db reset`)

| Suite | Result |
|---|---|
| `npm run test:sql` | **`===== summary: 47 passed, 0 failed (of 47 files) =====`**. Baseline was 46 files on `55df0b5`: +1 file and +15 PASS notices, all from `copilot_foundation.test.sql` (log lines `:75` to `:448`) |
| `npm run test:sql:client-portal` | `2 passed, 0 failed (of 2 files)`, unchanged |
| `npm test` | `64 passed (64)` files, `674 passed (674)` tests, unchanged |
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean in CI. Locally it reports duplicate-identifier errors **only** from iCloud-created `.next/types/* 2.ts` copies, because the checkout lives under the iCloud-synced Desktop. That's environment noise, not code |
| `npm run test:live` | locally 9 of 37 fail in `lib/bridge/client-portal.live.test.ts` (`link_unavailable`). **The same 9 fail on unmodified `origin/main`** (verified in a separate worktree on a fresh `db reset`), so it's pre-existing and environment-specific. CI ran this suite 37/37 on `55df0b5` (run 40197988522, log line `:3034`) |

### Production pre-check (read-only, 2026-10-29)

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
  - In production, `anon` and `authenticated` hold TRUNCATE on **66 of 73** public tables, including `audit_logs`, `payments`, `extractions` and `application_status_history`. This comes from Supabase's default privileges, read-only query of 2026-10-29. TRUNCATE skips RLS and append-only triggers.
  - It isn't reachable today: both roles are NOLOGIN, PostgREST has no TRUNCATE, and the RPCs run fixed SQL. Still, it's the same class as the 2026-10-11 writable-view incident.
  - **Proposal:** a small hardening migration that revokes TRUNCATE from `anon` and `authenticated` on all public tables, and alters default privileges so new tables don't get it.
- **F2 — 8 vacuous assertions in existing SQL tests.**
  - The locations are `ai_jobs_ledger_human_reviews.test.sql:222`, `application_document_chunks.test.sql:140,151`, `audit_logs.test.sql:155,166` and `drawing_review_schema.test.sql:251,262,273`.
  - They print `PASS … (FAIL: authenticated was able to UPDATE …)`. The UPDATE/DELETE silently matched 0 rows under RLS, the block's own `raise exception 'FAIL…'` fired, and `when others` turned it into a PASS.
  - The protected property still holds, because there's no UPDATE/DELETE policy, but those assertions prove nothing.
  - **Proposal:** rewrite them with a SQLSTATE-specific catch and a row-count check, test-only.
- **F3 — local `test:live` environment** (above). This is a local-only issue to diagnose separately. CI is green.
