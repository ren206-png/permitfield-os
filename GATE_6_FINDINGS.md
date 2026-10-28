# Gate 6 — LLM Permitting Copilot — Phase 0 Findings (read-only)

**Status:** investigation complete, zero implementation. This document is the whole Phase 0 deliverable. Then STOP.

- **Scope:** PermitField OS only (`ren206-png/permitfield-os`), audited at `main` = `55df0b5` (2026-10-28).
- **Input:** "PermitField OS — LLM Permitting Copilot … master prompt v2" (Oct 26).
- **Gate number:** "6" is a **proposal** (D3). Ren assigns the number.

**Method:**
- Every claim cites `path:line` against `55df0b5`, except four kinds of evidence:
  - prod row counts, which come from a read-only Management API query, timestamped in §C;
  - CI log lines, citing GitHub Actions run 40197988522;
  - `git` and `node` output;
  - the master prompt itself (§0/§1.x/§x.y).
- Nothing in the repo was modified:
  - The checkout was fast-forwarded `feat/ios-app → main`. No branch was created.
  - The baseline ran in a detached throwaway worktree at `/tmp/pf-p0` with its own `npm ci`, because the checkout's `node_modules` is stale (§C.3).
  - No migration, `supabase start` or `db reset` was run.

---

## A. Headline findings

1. **Most of the "foundation" in prompt §5–§9 already exists**, but it is empty or unwired:
   - **Source registry:** exists at `supabase/migrations/20260806000021_jurisdiction_sources.sql:93`, with 12 rows in prod.
   - **Requirements engine:** `permit_requirements` (`…026_permit_requirements_engine.sql:191`) has 141 rows in prod. `jurisdiction_permit_rules` (`…026:290`) has **0 rows**.
   - **Evaluator:** `evaluate_project_permit_requirements` is at `…027_permit_requirements_evaluator.sql:267`.
   - **Hybrid search:** full-text plus pgvector over `jurisdiction_code_chunks` (`…008_jurisdiction_code_chunks.sql:14`, search fn `…014`, `…037`, `…047`) has **0 rows in prod**.
   - **Org-document retrieval:** `application_document_chunks` (`…038:35`) has 0 rows and its flag is off. `retrieveOrgDocumentChunks` has **zero call sites**, as `lib/ai/retrieve-org-document-chunks.ts:12` itself says.

   This gate is mostly **extend and populate**, not build from scratch.
2. **Vectors (D4) are de facto already "full-text only":**
   - Every retrieval call passes `p_query_embedding: null` (`lib/ai/retrieve-code-chunks.ts:137`, `lib/ai/retrieve-org-document-chunks.ts:56`).
   - Voyage embedding code was removed in #83 (`4f0a9c8`), but `ai_provider` still lists `'voyage'` (`…036_ai_jobs_token_ledger_human_reviews.sql:49`) and `lib/ai/schemas/ai-task.ts:32`.
   - The `vector(1024)` columns and ivfflat indexes remain (`…008:29,39`; `…038:42,57`).
3. **Background jobs (D6) exist:**
   - Inngest serves 10 functions (`app/api/inngest/route.ts`).
   - Function config is synced on every prod deploy by `.github/workflows/sync-inngest.yml` (#78).
4. **Several prompt premises are stale** (§F):
   - The Gate 1.3 status values *are* consumed.
   - `OrgContext.role` *is* typed with all roles.
   - Drawing Intake, Readiness and Quotes & Payments have **landed**.
5. **Baseline is green, with counts** (§C):
   - Vitest: 64 files / 674 tests.
   - Live Vitest: 4 files / 37 tests.
   - SQL: 46 + 2 files, 519 PASS assertions.
   - Lint is clean and `tsc` is clean.
   - CI has **no standalone typecheck step**; types are checked only inside `next build`.
6. **Merge-convention conflict (new D9):**
   - The prompt's §1.10 says fast-forward only, no squash, never delete branches.
   - Every recent PR (#69–#86) was squash-merged, and on 2026-10-17 seven merged branches were deleted (their PRs keep the commits).
   - Ren must choose before 6.1.

---

## B. Inventory

### B.1 Tooling, config, CI

- **Scripts** (`package.json`):
  - `lint` → `eslint`;
  - `test` → `vitest run`;
  - `test:live` → `vitest run --config vitest.live.config.mts`;
  - `test:sql` → `bash scripts/run-sql-tests.sh`;
  - `test:sql:client-portal` → `bash scripts/run-client-portal-sql-tests.sh`;
  - `eval` → `tsx eval/run.ts`.
- **Versions (lockfile):**
  - Framework and data: next 16.4.3, react 19.2.8, zod ^4.6.7, inngest ^4.16.0.
  - AI and documents: @anthropic-ai/sdk ^0.115.0, pdf-lib ^1.17.1, pdf-parse ^2.4.5.
  - Supabase: @supabase/supabase-js ^2.112.1.
  - Payments and email: stripe ^22.6.2, resend ^6.28.1.
  - Tooling: vitest ^4.1.10, supabase ^2.111.0.
  - There is no geocoding, embedding or OCR SDK (grep for `geocod|mapbox|places|parcel` in `lib/` and `app/` finds nothing).
- **CI** (`.github/workflows/ci.yml`):
  - `build-and-test` runs `npm ci` (:86), `npm run lint` (:88), `npm run build` (:90) and `npm test` (:92).
  - `sql-tests` runs:
    - `supabase start` and `db reset` (:135, :140), then `npm run test:sql` (:142);
    - the client-portal stack (:153, :155), then `test:sql:client-portal` (:157);
    - `test:live` (:182), which must run after both SQL suites (:161).
  - The Supabase CLI is pinned at 2.114.0 (#77).
- **Other workflows:**
  - `deploy-migrations.yml` (`workflow_run` on CI success; pushes migrations to prod);
  - `sync-inngest.yml` (`deployment_status`, Production success).
- **Supabase project ids:** `permitfield-os` (`supabase/config.toml:5`) and `permitfield-client-portal` (`supabase-client-portal/supabase/config.toml:21`).
  - Both were proven parsed: running containers are named `supabase_*_permitfield-os` and `supabase_*_permitfield-client-portal` (§H, "unparsed config").
- **AI env** (`.env.example`): `ANTHROPIC_API_KEY` (:33), `GEMINI_API_KEY` (:42), `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (:45–46). No embedding key.
- **Lint boundaries** (`eslint.config.mjs`): `no-restricted-imports` rules at :28, :66, :119 and :165. :5–17 calls these the "ENTIRE enforced boundary" for the client-portal service client (Gate 2.0 §3). A Gemini-client restriction is at :82.

### B.2 Feature flags

- **Mechanism:** `lib/flags.ts:12-14`. `isEnabled(name)` returns `process.env[name] === 'true'`, read fresh on every call. It defaults to off, and only the literal `"true"` turns a flag on (:8–11).
- **There are 26 `PERMITFIELD_FF_*` accessors** (`lib/flags.ts:21`–`:431`).
- **Relevant to this gate:**
  - `AI_AUDIT` (:21), `AI_ROUTING` (:238), `AI_ASSISTANT` (:246), `AI_TOKEN_CAPS` (:255);
  - `ORG_DOCUMENT_RETRIEVAL` (:275), `REQUIREMENTS` (:114), `READINESS` (:96), `JURISDICTIONS` (:61);
  - `DRAWING_REVIEW` (:371), `CITY_SUBMISSION` (:422), `PERMIT_ESIGN` (:430), `CLIENT_PORTAL` (:158).
- **Divergence:** `isMarketingV2Enabled` reads `NEXT_PUBLIC_MARKETING_V2` (:168–175), the documented exception to the naming convention.

### B.3 Schema (main project: 90 migrations, `…001`–`…090`; client portal: 3)

**Tenancy and roles**
- `org_members` (`…002:13`).
- `org_role` started as `('owner','member')` (`…002:11`). Eight values were added at `…018:26-33`: `platform_admin`, `org_owner`, `permit_manager`, `permit_coordinator`, `document_reviewer`, `applicant_contractor`, `client_user` and `auditor_readonly`.

**Jurisdictions and authorities**
- `jurisdictions` (`…004:21`): columns `country` char(2) default `'CA'`, `province_code` text (no check), `municipality`, `region`, `coverage_level` (`verified|assisted|listed`, `…004:7`), `portal_url` and `verified_at`. It is unique on (country, province, municipality).
- `authorities` (`…004:36`): `authority_level` (`municipal|provincial|state|agency|utility`, `…004:14`) and `filing_mechanism` (`…004:16`).
- **Coverage is per-jurisdiction only.** It isn't keyed by permit family, scope or effective period (the prompt's §6 needs those).

**Sources and code corpus**
- `jurisdiction_sources` (`…021:93`) holds `source_type` (`fee_schedule|processing_times|forms_page|bylaw|other`, `…021:53`), `url`, `retrieved_at`, `verified_at`/`verified_by`, and a five-state verification status (`…021:62`).
  - A CHECK requires a reviewer when the status is `verified` (`…021:113-115`).
  - **Missing versus prompt §7:** content hash, immutable revisions, effective interval, supersession links, `last_successfully_checked_at`, licence notes.
- `jurisdiction_code_chunks` (`…008:14`) has `license_status` (`…008:12`), `embedding vector(1024)` (:29), a generated `content_tsv` with a GIN index (:30, :35) and ivfflat (:39).
  - The effective window and dimensions were added at `…037`.
  - Hybrid search functions are at `…014`, `…037:99` and `…047:44`.

**Requirements engine**
- Tables:
  - `permit_requirements` (`…026:191`) with `permit_requirement_verification_status` (`…026:183`);
  - `jurisdiction_permit_rules` (`…026:290`);
  - `project_permit_requirements` (`…026:345`);
  - `project_taxonomy_selections` (`…026:114`).
- `evaluate_project_permit_requirements(p_project_id)` (`…027:267`) and `review_project_permit_requirement(p_id)` (`…027:391`) are both `security definer`.

**Readiness**
- `readiness_checklist_items` (`…025:76`) with `readiness_item_status` (`…025:74`).
- `override_readiness_check(p_application_id, p_reason)` (`…025:267`, security definer).
- `transition_permit_status` is redefined at `…022:454`, `…025:336` and `…061:47`.

**Permit lifecycle**
- `permit_status_enum` (`…022:90`) has 16 values, from `intake` through `closed`.
- Its transition table includes `under_municipal_review → revision_requested`, `revision_requested → collecting_documents|resubmitted|withdrawn` and `resubmitted → under_municipal_review` (`…022:200-207`).
- `application_status_history` (`…022:291`).
- `permit_expires_on` (`…066:29`).

**Documents and AI pipeline**
- `application_documents` (`…006:35`) and `document_revisions` (`…024:110`).
- `extractions` (`…007:5`), `audits` (`…009:9`), `drawing_reviews` (`…045:43`).
- `generated_documents` (`…017:50`), `permit_type_filings` / `permit_form_fields` (`…005:19`, `:33`).
- `filing_submissions` (`…070:69`).

**AI accounting**
- `ai_jobs` and `ai_token_ledger` (`…036:79`, `:117`).
- `ai_task_kind` includes `assistant` and `checklist_generation` (`…036:61-67`), plus `drawing_review` (`…045:238`).

**Audit**
- `audit_logs` (`…018:52`).
- The external-actor branch has two CHECKs (`…030:41`, `:48`).

**Money (D2)**
- Integer cents via BigInt string parsing; there's no float path (`lib/money/cents.ts:1-11`).
- There are **no fee-schedule tables**. "Fee" appears only as a `jurisdiction_source_type` value (`…021:54`).

**Not present (grep for hot work, confined space, ground disturbance, pressure test, permit-to-work, chainage, AER, CER):**
- site permit-to-work modules;
- inspections or conditions tables;
- industrial or pipeline models.

### B.4 Application code

**Audit log**
- `writeAuditLog()` is at `lib/audit/log.ts:74`.
- It has **36 call sites in 16 files**, for example `lib/quotes-payments/change-orders.ts` (6), `lib/quotes-payments/invoices.ts` (4) and `lib/bridge/client-portal.ts` (3).
- It's no longer dead.

**Roles and authorization**
- `OrgContext.role` is typed as the full `Role` (`lib/auth/org-context.ts:29-31`). It's assigned with a bare cast, `membership.role as Role` (:73), with **no runtime guard**.
- In the `lib/authz` matrix, `client_user` is modelled at `lib/authz/index.ts:41`, `:155` and `:413`. Tests assert it fails closed for unmodelled pairs (`lib/authz/index.test.ts:22-25`, `:76`).

**Client-portal bridge**
- `lib/bridge/client-portal.ts` exports 14 functions:
  - `getBridgeRequestContext` (:173), `evaluateIpRateLimit` (:233), `resolveToken` (:490);
  - `getApplicationSummary` (:565), `getReadinessChecklist` (:640), `listDocuments` (:718);
  - `getDocumentDownloadUrl` (:781), `uploadDocument` (:919);
  - `issueToken` (:1167), `revokeToken` (:1305), `listTokensForApplication` (:1372);
  - `resolveTargetToken` (:1534), `lifecycleActorColumns` (:1620), `issueTargetToken` (:1674).
- It's imported by 17 `app/` files (the estimate, invoice, change-order, credit-note and sign token pages, admin client-portal) and by 22 `lib/` files.
- The copilot must have no import path to it (prompt §3.12, §19 "portal reach").

**AI**
- `lib/ai/router.ts` routes tasks across Anthropic and Gemini.
- `lib/ai/config.ts` sets the models:
  - `MODEL_ID = 'claude-sonnet-5'` (:8) for extraction, audit and drawing review;
  - `HELP_MODEL_ID = 'claude-haiku-5-5'` (:53);
  - `GEMINI_ASSISTANT_MODEL_ID` / `GEMINI_CLASSIFICATION_MODEL_ID = 'gemini-2.5-flash'` (:81-82).
- Cost controls: `lib/ai/cost-caps.ts` and `lib/ai/estimate-cost.ts`.
- Zod schemas live in `lib/ai/schemas/{extraction,audit,classification,drawing-review,ai-task}.ts`.
- `lib/ai/guards/approval-promise.ts` guards against model text that promises approval.

**Help assistant** (live; the closest thing to a copilot)
- It's `app/(app)/help-actions.ts`. It answers only from `lib/help/guide.ts` and has no tools or retrieval.
- It logs to `ai_jobs` with kind `assistant` (`help-actions.ts:45-51`).

**Background jobs** (`app/api/inngest/route.ts`)
- 10 functions: `permitExtract`, `permitAudit`, `permitGeneratePdf`, `notifyOnFailure`, `permitQuotesPaymentsReminders`, `permitDrawingReview`, `permitNotify`, `permitNotifyFlush`, `permitClassifyDocuments` and `permitIngestDocumentChunks`.
- Re-runs are keyed by a documents fingerprint (#76).

**Parsers**
- `pdf-parse` (text-native PDFs).
- `lib/pdf/text-density.ts` routes scans to Claude vision.
- `pdf-lib` handles form fill.
- There's no DOCX, XLSX or CSV loader, and no OCR library.

**Storage policies:** 6 storage policy statements across the migrations.

### B.5 Prior workstreams: landed versus spec

| Workstream | Doc | Code landed? |
|---|---|---|
| Lifecycle & Compliance (Phase 0) | `PHASE_0_FINDINGS.md` | Yes: projects, properties, taxonomies (`…019`), status machine (`…022`), readiness (`…025`), requirements (`…026`/`…027`) |
| Gate 1.3 status machine | `GATE_1.3_REPORT.md` | Yes (`…022`) |
| Gate 2.0 client portal | `GATE_2_0_FINDINGS.md`, `GATE_2_0_SPEC.md` | Yes: second project, bridge (`lib/bridge/client-portal.ts`) |
| Gate 3.0 (incl. "Application Readiness Review", `GATE_3_0_FINDINGS.md:64`) | `GATE_3_0_FINDINGS.md` | Readiness checklist, override and readiness gate landed (`…025`, `lib/submissions/readiness-gate.ts`) |
| Gate 4 Quotes & Payments (A/B/C) | `GATE_4_*FINDINGS.md` | Yes: estimates, invoices, payments, change orders, credit notes, Stripe Connect (`…052`–`…062`) |
| Gate 5 Drawing Intake, Pre-Review, Notifications | `GATE_5_FINDINGS.md` | Yes: `drawing_reviews` (`…045`), notifications (`…049`), Inngest `drawing-review` |
| Gate AI-1 routing, cost caps, classification, org retrieval | `GATE_AI_1_FINDINGS.md` | Mostly: router, Gemini, cost caps, classification, chunk ingestion (#81); the retrieval consumer is **unwired** |

### B.6 AGENTS.md / CLAUDE.md (prompt §1.9)

- `git log --follow -- AGENTS.md` shows a single commit, `37d1c5e`. `git diff --stat 37d1c5e -- AGENTS.md CLAUDE.md` is empty, so **neither has changed since `37d1c5e`**.
- Blob hashes are `643577df…` (AGENTS.md) and `43c994c2…` (CLAUDE.md).
- The file claims to be written by `next dev`. `node_modules/next/dist/server/lib/generate-agent-files.js` exists in the installed Next, which is consistent with that claim, but provenance isn't proven.
- Per §1.9, its behavioural text was read and not followed.
- There are no other agent-directed files: `git ls-files` finds only `AGENTS.md` and `CLAUDE.md`, with no `.cursorrules` and no copilot instructions.

---

## C. Baseline (prompt §4.2)

### C.1 CI on `55df0b5` (run 40197988522, all jobs succeeded)

| Suite | Command | Result (log line) |
|---|---|---|
| Lint | `npm run lint` | clean, no output (from :3220) |
| Build | `npm run build` | compiled, 47/47 static pages (:3246, :3254) |
| Vitest | `npm test` | **64 files / 674 tests passed** (:3416–3417) |
| SQL, main | `npm run test:sql` | **46 passed, 0 failed (of 46 files)** (:2884) |
| SQL, client portal | `npm run test:sql:client-portal` | **2 passed, 0 failed (of 2 files)** (:3010) |
| Live Vitest | `npm run test:live` | **4 files / 37 tests passed** (:3033–3034) |
| SQL assertions | (count of `NOTICE:  PASS` lines) | 519 |

### C.2 Local confirmation (`/tmp/pf-p0`, fresh `npm ci`, 728 packages)

- `npm test`: 64 files / 674 tests passed, identical to CI.
- `npx next typegen && npx tsc --noEmit` was clean. **CI never runs `tsc` on its own**; type errors surface only in `next build`.
- `npm run lint` was clean.

### C.3 Not run locally, and why

- **SQL suites:** these need `supabase db reset`, which would wipe the local dev database. Phase 0 forbids that beyond baseline needs, and CI's run is the artefact.
- **Live suite:** this commits to a real local stack after the SQL suites, so the same reason applies.
- **Environment note:** the user's checkout has stale `node_modules`, for example next 16.3.8 installed versus 16.4.3 in the lockfile, and zod 4.4.3 versus 4.6.7. Any local run there would test the wrong versions.
- **Pre-existing failures:** none. **Environment failures:** none in CI.

**Prod snapshot (read-only, 2026-10-28):**

| Table | Rows |
|---|---|
| `jurisdictions` | 11 |
| `authorities` | 12 |
| `jurisdiction_sources` | 12 |
| `permit_requirements` | 141 |
| `jurisdiction_permit_rules` | 0 |
| `jurisdiction_code_chunks` | 0 (with embeddings: 0) |
| `application_document_chunks` | 0 |

---

## D. Overlap matrix (prompt §4.3)

| Capability (§2) | State | Where / owner |
|---|---|---|
| Collect project facts | **Partial.** Intake records projects, properties and taxonomy selections; there's no typed, append-only fact ledger with provenance | `…019:109,143`; `…026:114` → extend in 6.1 |
| Resolve authorities | **Partial.** Jurisdiction and authority tables exist; the user picks a jurisdiction manually and there's no resolution engine or result-type enum | `…004:21,36` → 6.2 |
| Identify permits and approvals | **Exists, empty.** The rules engine and evaluator exist, but `jurisdiction_permit_rules` = 0 rows | `…026:290`; `…027:267` → extend and populate in 6.2 |
| Versioned checklists with evidence | **Exists.** Readiness items, suggested items and the "Verified by PermitField" label. There are no versioned snapshots per rule-set version | `…025:76`; `…026:345` → 6.1/6.2 |
| Extract details from documents and drawings | **Exists.** 6-field extraction (`lib/ai/schemas/extraction.ts`) and drawing review (Gate 5) | extend in 6.4 (fact proposals into the ledger) |
| Package completeness | **Exists.** Readiness gate plus override | `lib/submissions/readiness-gate.ts`; `…025:267` → extend in 6.2 |
| Draft fields | **Exists** (PDF fill per filing) | `…017:50`; `lib/inngest/functions/generate-pdf.ts` |
| Draft cover letters and correction responses | **Net-new** | 6.5 |
| Retrieve and explain guidance with citations | **Exists, empty.** Hybrid search over a 0-row corpus. Org-document retrieval has an unwired consumer | `…014`/`…037`/`…047`; `lib/ai/retrieve-code-chunks.ts`; `retrieve-org-document-chunks.ts:12` → 6.3 |
| Estimate fees | **Net-new.** No fee tables; only a `fee_schedule` source type | `…021:54` → 6.5 |
| Track applications, receipts and expiry | **Exists** | `…022`, `…070:69`, `…066:29` |
| Conditions and inspections | **Net-new** | 6.6 |
| Site permit-to-work kept separate | **Net-new. Nothing to preserve** (none exists) | 6.6, or defer (Q-list) |

There's nothing "specified elsewhere but not implemented" that this gate would duplicate. The Gate AI-1 retrieval consumer is the one unwired item, and it naturally belongs to 6.3.

---

## E. Decisions (prompt §0 D1–D8, plus D9)

- **D1 (coverage scope)**
  - **Evidence:** the schema is already country- and province-generic: `country` defaults to `'CA'`, and `province_code` is free text (`…004:21-33`). Prod has 11 jurisdictions in AB, BC and ON. Coverage is per-jurisdiction only.
  - **Recommendation:** accept the default (AB/ON/BC verified content, nationwide-capable schema). Add a coverage table keyed by authority, permit family, scope and effective period in 6.1.
- **D2 (money)**
  - **Evidence:** the house rule is already integer cents with no float path (`lib/money/cents.ts:1-11`).
  - **Recommendation:** accept the default. Fee schedules store minor units, currency and a rounding rule on the version row.
- **D3 (gate number and order)**
  - **Evidence:** existing gates are 1.3, 2.0, 3.0, 4 (A/B/C), 5 and AI-1. Gate 3.0's readiness review, Gate 4 and Gate 5 have all landed (§B.5).
  - **Proposal:** **Gate 6**, with no blocking dependency on open workstreams, because none of them are open.
- **D4 (embeddings)**
  - **Evidence:** pgvector, 1024-dimension columns and ivfflat indexes exist. The Voyage code was removed (#83), and every caller passes a null embedding (§A.2).
  - **Recommendation:** ship full-text only, as the default says. Keep the vector columns untouched (additive-only).
  - **Question for Ren:** should `'voyage'` stay in `ai_provider`? Enum values can't be dropped additively, so the recommendation is to leave it.
- **D5 (geocoding):** there's no provider in the code (grep is empty). Accept the default: a `manual_confirmation` adapter only.
- **D6 (jobs):** Inngest exists and is synced on deploy. **Recommendation:** use Inngest; no new job table.
- **D7 (overlap):** see §D. This gate extends the requirements engine, readiness, extraction and retrieval. It doesn't re-implement them.
- **D8 (portal):** the bridge's surface is listed in §B.4. **Recommendation:** accept staff-only. Add a `no-restricted-imports` rule that stops any `lib/ai/copilot/**` or `lib/ai/tools/**` module from importing `lib/bridge/client-portal` or the portal service client, in the same style as `eslint.config.mjs:28`.
- **D9 (new: merge convention, prompt §1.10)**
  - **Evidence:** the repo history is squash merges, e.g. `55df0b5 … (#86)` and `d58d200 … (#78)`, each a single commit. Merged branches have been deleted.
  - **Ren must choose:**
    - **(a)** follow §1.10 for Gate 6 branches only: fast-forward, no squash, branches kept; or
    - **(b)** keep the repo's squash convention.

    Option (a) needs `gh pr merge --rebase` or a local `git merge --ff-only` plus push, and branch auto-delete off.
  - **Blocking for 6.1's merge step only.**

### E.1 Additional blocking decision

- **B1 (content onboarding owner).** 6.2 and 6.3 produce verified rules and corpus only if someone reviews primary sources. The schema and review console can ship without content, but the gate's user-facing value depends on content.
  - Who reviews, and which sources go first (AB/ON/BC)?

### E.2 Non-blocking questions

- **Q1.** `MODEL_ID = 'claude-sonnet-5'` (`lib/ai/config.ts:8`) works in prod: extraction-v2 ran successfully on 2026-10-17. Should the copilot use the same model or a newer one? Prompt §12 says to verify at implementation time.
- **Q2.** CI lacks a standalone `tsc --noEmit` (§C.2). Add it in 6.1? It's cheap, and it closes a "green badge" gap.
- **Q3.** Permit-to-work (§15) has nothing to preserve. Defer it from Gate 6 entirely, since the product has no industrial users today?
- **Q4.** The user's checkout `node_modules` is stale (§C.3). Run `npm ci` there? (Not done in Phase 0.)

---

## F. Prompt premises that don't match the repo

| Prompt says | Repo shows |
|---|---|
| §4.1 / §15: Gate 1.3's `revision_requested` / `resubmitted` / `appeal_filed` are "unconsumed" | They have transition edges (`…022:200-207`) and are used in `lib/permit-status/transitions.ts:35-37,56` and `lib/submissions/readiness-gate.ts:11-12`; the UI offers them |
| §1.8: `OrgContext.role` "is typed narrower than the real `org_role` enum" | Fixed: typed as the full `Role` (`lib/auth/org-context.ts:29-31`). Still true: there's **no runtime guard** (:73 is a cast) |
| §1.13: `writeAuditLog()` "sat with zero call sites" | 36 call sites in 16 files (§B.4) |
| D6: background-job stack unknown | Inngest, 10 functions, synced on deploy (§B.4) |
| D7: Drawing Intake, Readiness Review, Quotes & Payments status unclear | All landed (§B.5) |
| §11: build hybrid retrieval | Hybrid search functions exist (`…014`, `…037`, `…047`). The corpus is empty and the org consumer is unwired |
| §8: "reuse existing … sources" with immutable revisions | `jurisdiction_sources` exists but is mutable (`updated_at`, `…021:93-105`), with no hash, revision or supersession. Needs an additive revisions table |

---

## G. Proposed gate plan (adapts prompt §17)

Each sub-phase: one branch, one PR, merged per the D9 decision, and its own `APPROVED: PHASE 6.<n>`.

| Sub-phase | Scope | Blast radius | Flag |
|---|---|---|---|
| 6.1 | Additive tables: `project_facts` (append-only); `source_revisions` (immutable, hash, effective interval, supersedes) beside `jurisdiction_sources`; `coverage_records`; `rule_set_versions` and requirement snapshots linked to `project_permit_requirements`; `fee_schedule_versions`; `copilot_tool_invocations`. RLS, grants, rollback comments, control-then-assert SQL tests. Optional CI `tsc` step (Q2) | 6 new tables, 0 altered; new grants to `authenticated`/`service_role` only on new tables | none (schema only) |
| 6.2 | Authority resolution result type plus `manual_confirmation` adapter; safe rule engine extending `evaluate_project_permit_requirements` (three-valued, cycle detection); readiness extension (no fork of `override_readiness_check`) | New SQL fns; additive columns only if needed | `PERMITFIELD_FF_COPILOT_RULES` |
| 6.3 | Source staging, review and publication (admin); refresh with diffs via Inngest; wire `retrieveOrgDocumentChunks`; full-text citations validated by Zod | New jobs; admin pages | `PERMITFIELD_FF_SOURCE_REGISTRY` (+ existing `ORG_DOCUMENT_RETRIEVAL`) |
| 6.4 | Provider adapter (reuse `lib/ai/router.ts`), Zod tool registry (10 tools, §12), bounded orchestrator, staff UI, fact-extraction review; ESLint portal-boundary rule (D8) | New `lib/ai/copilot/**`; no portal path | `PERMITFIELD_FF_COPILOT` |
| 6.5 | Cover letter and correction-response drafts; fee estimates (integer cents) | Additive | under `COPILOT` |
| 6.6 | Conditions and inspections; connector contracts (interfaces only); permit-to-work if Q3 says yes | Additive | TBD |
| 6.7 | Hardening (SSRF, injection fixtures, quotas, cost), evaluation set, §19 run | none | — |

**Out of this gate unless Ren adds them:**
- vector retrieval (D4);
- geocoding (D5);
- portal exposure (D8);
- real submission connectors.

---

## H. Adversarial self-checks for Phase 0 (prompt §19)

| Check | Result |
|---|---|
| Green badge, zero tests | Counts quoted from CI log lines (§C.1), not the badge |
| Unparsed config | Both `project_id`s proven by the container names `supabase_*_permitfield-os` / `supabase_*_permitfield-client-portal` (`docker ps`, 2026-10-28 rebuild) |
| Dead helper | `retrieveOrgDocumentChunks` has zero call sites (its own header, `:12`); owner: 6.3 |
| Flag that gates nothing | `PERMITFIELD_FF_ORG_DOCUMENT_RETRIEVAL` gates ingestion (`lib/inngest/functions/ingest-document-chunks.ts:23`), but retrieval has no consumer; owner: 6.3 |
| Model-trusted scope | Ingestion reads `org_id` from the application row, not the event (`lib/ai/ingest-org-document-chunks.ts:11-12`) |
| Portal reach | Copilot code doesn't exist yet. Boundary rule planned in 6.4 (D8) |
| AGENTS.md | Unchanged since `37d1c5e` (§B.6); instructions not followed |
| Squash merge | **Fails §1.10 historically** → D9 |

---

## §7 Open items (each has an owning sub-phase)

| # | Item | Owner |
|---|---|---|
| O1 | `jurisdiction_permit_rules` has 0 rows in prod | 6.2 (engine) + B1 (content) |
| O2 | `jurisdiction_code_chunks` and `application_document_chunks` have 0 rows | 6.3 |
| O3 | `retrieveOrgDocumentChunks` unwired | 6.3 |
| O4 | `jurisdiction_sources` mutable, no revisions or hash | 6.1 |
| O5 | Coverage is per-jurisdiction only | 6.1 |
| O6 | No runtime guard on `OrgContext.role` (`org-context.ts:73`); copilot tools must use DB predicates, not this | 6.4 |
| O7 | CI has no standalone typecheck | 6.1 (if Q2 yes) |
| O8 | `'voyage'` lingers in `ai_provider` / `AiProviderSchema` | 6.7 (or leave, per D4) |
| O9 | Merge convention | D9, before 6.1 merges |

**STOP.** Waiting for Ren's decisions on D1–D9 and B1, then `APPROVED: PHASE 6.1`.
