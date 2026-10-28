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

---

## 6.3 — Source registry: refresh, staging, review, publication, retrieval and citations

**Approval:** `APPROVED: PHASE 6.3` (Ren, 2026-10-28), together with "merge 89" (#89 merged 21:13Z).

**Flag:** `PERMITFIELD_FF_SOURCE_REGISTRY` (default off, set in no environment). Check sites:
- `isSourceRegistryEnabled()` in every page under `app/admin/sources/**` and `app/admin/rule-sets/**`, in every action in their `actions.ts`, and in the admin nav (`app/admin/layout.tsx`);
- both Inngest functions in `lib/inngest/functions/source-check.ts` return `flag_off` before reading anything.

### What changed

| File | Purpose |
|---|---|
| `supabase/migrations/20260806000094_copilot_source_registry.sql` | **Tables** (all four append-only, no INSERT grant to any API role):<br>• `source_captures`: staged, unreviewed fetched text, admin-only RLS.<br>• `source_check_runs`: every check attempt.<br>• `source_capture_decisions`: one publish/dismiss decision per capture.<br>• `source_revision_chunks`: searchable text of published revisions.<br>**Functions:**<br>• `record_source_check`: service_role only, idempotent on a caller key.<br>• `publish_source_revision` / `dismiss_source_capture`: `is_platform_admin()`, actor = `auth.uid()`.<br>• `search_source_evidence`: exact filters, full-text search.<br>• `source_check_status`: one row per source.<br>• `publish_rule_set_version`: snapshot built from the DB.<br>• `source_revision_is_published`.<br>Rollback SQL is in the header. |
| `lib/sources/url-guard.ts`, `fetch-source.ts` | Outbound fetch: https only, no credentials, port 443 only, every DNS answer must be public (checked inside the socket's `lookup`), each redirect re-validated (max 3), 20 s total timeout, 10 MB streamed cap, conditional `If-None-Match` / `If-Modified-Since`. Never throws: every outcome is a value. |
| `lib/sources/loaders.ts` | HTML (`<main>` only if present; scripts, styles, forms and embeds dropped; sections located by heading path), PDF (text layer, located `p. N`), plain text. Declared type must match the bytes. Everything else is refused as `unsupported_content`. |
| `lib/sources/capture.ts` | Normalised text, sha256 of that text, located chunks, Zod `SourceCaptureSchema`. Oversize content is refused, never truncated. |
| `lib/sources/check-source.ts` | One check: fetch → load → capture → `record_source_check` arguments. The fetcher is injected for tests. |
| `lib/inngest/functions/source-check.ts` | `source-check` has durable steps `load-source` → `fetch` → `record`, idempotency key `sourceId + requestKey`, per-source concurrency 1. `source-refresh-scheduler` is a daily 04:00 America/Edmonton cron that queues due sources (max 50 per run). |
| `lib/sources/freshness.ts` | Policy: fee schedule, processing times and forms pages every 30 days; bylaw and other every 90 days; retry 24 h after a failed attempt. A failed check never counts as successful. |
| `lib/sources/diff.ts` | Bounded line diff (LCS after prefix/suffix trim, ≤ 2000 lines). Over the bound it says "not computed" rather than showing a partial diff. |
| `lib/sources/evidence.ts` | `buildEvidenceBundle`: official chunks from `search_source_evidence` (`S1…`) plus the org's own document chunks via `retrieveOrgDocumentChunks` (`D1…`, only when `ORG_DOCUMENT_RETRIEVAL` is on). The two kinds stay separate. |
| `lib/sources/citations.ts` | `validateCitations`: Zod-parsed `{evidence_id, quote}`. The id must be in the bundle and the quote must appear in that evidence; only whitespace, case and typographic quote/dash differences are tolerated. Failures are rejected with a reason, never repaired. |
| `lib/sources/rule-set-publish.ts` | Validates the admin's condition JSON with the 6.2 `ConditionSchema` and runs 6.2 `validateRuleSet` over the would-be snapshots before publishing. `diffRuleSet` uses key-order-independent comparison. |
| `app/admin/sources/**`, `app/admin/rule-sets/**` | Console: source list (freshness, last check, items to review, Check now); per source (diff of each staged capture against the published text, publish form with effective dates and use rights, dismiss, withdraw, check history); rule sets per permit type (changes since the current version, conditions, publish). |
| `lib/inngest/client.ts`, `app/api/inngest/route.ts` | `source/check.requested` event; both functions registered. |
| `lib/ai/retrieve-org-document-chunks.ts` | Header corrected: ingestion exists and the caller is `buildEvidenceBundle`. |
| `lib/requirements/rules/rule-set.ts`, `run.ts` (6.2 code) | `z.uuid()` → `z.guid()`. See finding F6. |

### Requirement → code → verification

| Requirement (master prompt) | Code | Verification (artefact) |
|---|---|---|
| §17 N.3 exit: ingestion job survives disconnect | Durable steps + `record_source_check` idempotency key | **Live local run** with the Inngest dev server v1.46.0 (cached binary) and `next dev`:<br>• event `01M6273AAVTG2RZKKVEHK926WG` checked a test source whose URL takes 8 s;<br>• the Next server was **killed during `fetch`** (21:36:54Z, `curl` → connection refused, 0 rows) and restarted;<br>• the Inngest run `01M6273AH3HT21JAVH23FJHEPH` trace shows `load-source` 21 ms (not re-run), **`fetch` "1 retry"** (53.1 s including the outage), `record` 37 ms, status **Completed**;<br>• the DB has exactly **1** `source_check_runs` row, key `source-check:01M6273AAVTG2RZKKVEHK926WG`.<br>SQL test: "a replayed step returns the first result and writes nothing (1 run, 1 capture)". |
| §17 N.3 exit: citation validation test | `validateCitations` | `citations.test.ts` covers five cases:<br>• a valid citation resolves to its revision id and locator;<br>• fabricated quotes, unknown ids, cross-item quotes, extra keys and short quotes are each rejected with a reason;<br>• a non-list or an oversized list is refused;<br>• contractor evidence keeps its label. |
| §7 failed fetch ≠ repeal; changed page ≠ changed rule | Failures are only a `failed`/`blocked` row; the hash is over the normalised text | SQL: "a failed fetch is recorded as failed and leaves the source untouched". Unit: "markup-only changes give the same hash". |
| §7 conditional retrieval | ETag/Last-Modified from the last successful check | Live: a re-check of the published Hamilton page returned **`not_modified`** (304), with still 1 capture. |
| §7 LLM/fetch output → staging only; authorized reviewers publish | Captures are not revisions; publish is admin-only and atomic | SQL: a member cannot publish; admin publication creates revision, chunks, verified review and decision with actor = `auth.uid()`; a capture can be decided once. Live: the Hamilton capture was published from the console as revision 1. |
| §7 unknown effective dates stay unknown | Blank date fields → null | Console shows "effective unknown to open". |
| §11 exact filters before content reaches the model | `search_source_evidence` | SQL **decoy municipality**: the same words in "Decoyville" never appear in Toronto results (control: Decoyville finds its own row). Effective dates pick the revision in force (today → rev 1, +40 days → rev 2). Staged text is never searchable. |
| §11 revocation checked at query time | Newest revision in window, then the published filter | SQL: a withdrawn revision disappears at once **with no fallback** to older text; its chunk still exists (hidden, not deleted). |
| §10 reject unsupported content; no binary-as-text; nothing executed | `loaders.ts` | `loaders.test.ts`: DOCX, XLS, CSV, PNG and ZIP are refused; signature mismatches are refused; scripts, styles, comments, forms, iframes and SVG are dropped. Real PDF via `pdf-lib`: pages located `p. 1`, `p. 2`. |
| §19 SSRF | `url-guard.ts`, `guardedLookup` | `url-guard.test.ts`, 46 cases: private, loopback, link-local/metadata, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped, NAT64, 6to4, `localhost.`, `.internal`, http/file/ftp, credentials, non-443 ports. `guardedLookup('localhost')` → `address_not_public`. |
| §7 publication creates an immutable rule-set version | `publish_rule_set_version` | SQL covers four cases:<br>• admin-only;<br>• unverified or other-permit-type requirements → `check_violation`;<br>• a jurisdiction mismatch → `foreign_key_violation`;<br>• a forged title in the payload is ignored (the snapshot comes from the DB), the condition is kept, the newest published source revision is cited, v2 increments and supersedes, and v1 is unchanged. |
| §1.7 append-only | Triggers + no INSERT grants | SQL: an admin cannot insert a chunk directly; service_role cannot insert a capture directly; UPDATE and DELETE are blocked by the trigger as postgres. |

### Test evidence (local, 2026-10-28)

- **Unit tests:** 73 files / 778 tests passing (6.2: 68 / 701). +5 new files with 76 tests, plus 1 F6 regression test in `rule-set.test.ts`.
- **SQL suite:** `npm run test:sql` after `supabase db reset` gives **49/49 files, 553 PASS lines** (6.1a: 48 / 524). `source_registry.test.sql` has 29 PASS lines. It catches specific SQLSTATEs only; its one "when others" is in the header comment.
- **Mutation checks (§19 vacuous test):**
  - with `source_revision_is_published` forced to `true`, the test fails at "a member still sees chunks of a withdrawn revision";
  - with the jurisdiction filter removed from `search_source_evidence`, it fails at the decoy control (got 2).
  - Both ran inside the test's own rolled-back transaction.
- **Checks:** `npx next typegen && npx tsc --noEmit` clean; `npm run lint` clean.
- **Live local run:**
  - The console rendered with the flag on and a local `platform_admin` test account.
  - "Check now" on the real Hamilton page: HTTP 200, `changed`, 31,645 characters in 33 located chunks.
  - Published from the console.
  - `search_source_evidence` returned Hamilton passages located by heading path.
  - A re-check returned `not_modified`.

### Introduced, not yet wired (§1.13)

| Object | Owner |
|---|---|
| `buildEvidenceBundle`, `searchOfficialSources`, `validateCitations` (and therefore the new caller of `retrieveOrgDocumentChunks`) | 6.4 (copilot tools and answer rendering). Plan deviation: the 6.3 plan said "wire `retrieveOrgDocumentChunks`". It now has a caller, but that caller has no caller until 6.4. |
| "Affected active projects get a review-new-requirements task with a diff" (§7) | **Not built.** It needs the project-side UI. Owner 6.4. `diffRuleSet` exists for it. |
| Rule-set prerequisites (`requires`) | The console always publishes `[]`. The engine supports them; there is no editor yet. Owner 6.4, or on request. |

### Known limits (stated plainly)

- **Raw snapshots are not stored.** `snapshot_storage_path` stays null; the extracted text in `source_captures` is the retained snapshot.
- **Site chrome on pages without `<main>`.** On such pages the extracted text includes headers like Hamilton's election banner. A reviewer sees it in the diff.
- **robots.txt is not consulted.** Checks are low-frequency (30/90 days) and identify themselves via the User-Agent. Owner 6.7 (hardening).
- **Loaders cover HTML, PDF and text only.** DOCX, spreadsheets and images are refused explicitly. There is no manual-upload path for a source yet: only URL fetch.
- **The daily scheduler was not run live.** Its selection logic is unit-tested (`isCheckDue`). The first real run happens when the flag is on in an environment.
- **`writeAuditLog()` is not used.** `audit_logs` requires an `org_id` and these are platform-level actions. The actor is recorded on every append-only row instead (`created_by`, `reviewed_by`, `decided_by`, `published_by`, `requested_by`).

### §19 adversarial checks

| Check | Result |
|---|---|
| Vacuous test | Control-then-assert throughout, plus the two mutation runs above |
| Green badge, zero tests | Counts quoted from the local runs. CI counts are to be quoted from the PR's logs |
| Dead helper | Listed above with owners |
| Flag that gates nothing | Check sites listed under **Flag** |
| Model-trusted scope | No model input in 6.3. Publication actor = `auth.uid()`; the snapshot is built from DB rows; the rule-set jurisdiction comes from the permit-type row, not the form |
| Semantic jurisdiction | Decoy-municipality SQL test plus its mutation |
| Silent coercion | `.default([])` only on `requires` (an absent list means none). The `optionalDate` transform maps `''` to null, meaning unknown. No `.catch()` |
| Prompt injection via evidence | Not yet reachable: no model reads evidence until 6.4. Captures are inert text, and citations must quote evidence verbatim. Fixture test owner: 6.4/6.7 |
| SSRF | See the requirement table |
| Orphaned finding | Inherited items are audited below |

### Inherited items audit

- **6.2 plan deviation, not stated at the time:**
  - The plan (`GATE_6_FINDINGS.md` §G) said the rule engine would extend the SQL `evaluate_project_permit_requirements`. 6.2 built it in TypeScript (`lib/requirements/rules/`) instead, so the existing SQL evaluator is unchanged and unused by the engine.
  - The plan's "readiness extension" was not done in 6.2. `summarizeEvaluation` exists but is not connected to readiness. Owner: 6.4.
- **F3** (local `test:live`): still open, local only.

### New findings (each needs Ren's call)

- **F4 — no platform admin in production.**
  - A read-only query (2026-10-28) shows `org_members` roles are `owner` × 2 and nothing else.
  - The `/admin` panel is gated by the `ADMIN_EMAILS` allowlist, but every 6.1/6.3 write (`is_platform_admin()`) needs an `org_members` row with role `platform_admin`. With the flag on today, Publish/Dismiss/Withdraw would all fail with "the database does not recognise your account as a platform admin".
  - `org_members.role` is one value per (org, user), so making your existing row `platform_admin` would replace `owner` in your own org.
  - **Options:** (a) a separate internal "PermitField Platform" org where your account is `platform_admin` (needs a check that the app picks the right org when a user has two); (b) a small `platform_admins` table and an updated `is_platform_admin()`; (c) leave as is until the console is needed.
- **F5 — iCloud duplicate files in the repo.**
  - The repo is under `~/Desktop`, which iCloud syncs. It produced byte-identical untracked copies: `"20260806000093_public_roles_no_truncate 2.sql"` (which **broke `supabase db reset`** with a duplicate version), `"public_roles_no_truncate.test 2.sql"`, nine `lib/**/… 2.ts` copies of 6.2 files, and `ios/App/App/config 2.xml`.
  - I moved them out (not deleted) to the session scratchpad.
  - PlyCount had the same problem and was moved to `~/Developer`. **Recommendation:** move this repo out of iCloud as well.
- **F6 — `z.uuid()` rejects real catalogue ids (fixed here).**
  - Zod 4's `z.uuid()` enforces RFC 9562 version/variant bits. All 12 production `jurisdiction_sources` ids and all 12 `permit_types` ids (e.g. `00000000-0000-0000-0005-00000000000a`) fail it; read-only query 2026-10-28.
  - Found live: "Check now" silently returned "Invalid source." Switched to `z.guid()` in 6.3 code and in 6.2's `RuleSetItemSnapshotSchema.requires` / `run.ts`, with a regression test.
  - The rest of the codebase has 13 older `z.string().uuid()` validators, which are just as strict. They check generated ids (org, job, chunk, client) or `taxonomies` ids, and `taxonomies` has 0 rows in production (read-only, 2026-10-28). So nothing is affected today; a hand-written taxonomy id added later would be rejected. Proposed: switch them to `z.guid()` in 6.7.
