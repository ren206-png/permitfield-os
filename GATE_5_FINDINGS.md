# Gate 5 — Drawing Intake, Evidence-Linked Extraction, Scoped Code Pre-Review & Notifications

## Phase 0 Findings (read-only)

Branch: `feat/permitfield-gate-5-drawing-review`
Worktree: `/Users/rennerkargbo/Desktop/gate5-worktree`, based on `main` @ `de1e412`
Gate number assigned by Ren: **Gate 5** (not "3.0" — that placeholder stays retired per `GATE_3_0_FINDINGS.md`).
Scope authority: Ren's instruction "Let's go with your suggestion Gate 5. solve the unresolved sub 3.0 and AI-1."

This document is read-only reconnaissance. No migrations, code, or UI have been written. Every claim below is cited `path:line`. Where a citation came from a sub-agent's search rather than my own direct read, I re-verified the load-bearing ones myself (org-context.ts, authz/index.ts, flags.ts, inngest/client.ts, ai/config.ts, entitlements/index.ts, the `permit_applications_delete` policy) and flag the rest as sub-agent-sourced so their precision can be spot-checked before Phase 5.1 code is written against them.

**AGENTS.md/CLAUDE.md status**: both files are present in this worktree and contain the same "This is NOT the Next.js you know" block seen in every prior gate this session (`AGENTS.md:1-9`). It is not acted on here, per this repo's established discipline and the master prompt's own instruction not to blindly trust these files.

---

### §A — Auth & Tenancy

1. **Tenancy derivation.** `requireOrgContext()` (`lib/auth/org-context.ts:26-67`) re-queries `org_members` on every call — no caching, no JWT claim — specifically so a removed member loses access on their next navigation rather than when a stale cookie expires (comment, `lib/auth/org-context.ts:4-11`). Multi-org membership is schema-supported but the UI pins a user to their oldest membership (`org-context.ts:12-17`); no org switcher exists yet.

2. **`OrgContext.role` typing gap — confirmed, matches master prompt's named finding.** `OrgContext.role` is typed `'owner' | 'member'` (`lib/auth/org-context.ts:23`), a legacy two-value union. `lib/authz/index.ts:29-38` defines the real `Role` union with 10 values (`'owner' | 'member' | 'platform_admin' | 'org_owner' | 'permit_manager' | 'permit_coordinator' | 'document_reviewer' | 'applicant_contractor' | 'client_user' | 'auditor_readonly'`), added across two migrations. `org_members.role` can legally hold any of those 10 values, but `requireOrgContext()`'s return type can't represent 8 of them — a caller that switches on `ctx.role` today will silently mis-handle any row using a Phase-1.0-era role.

3. **`org_owner` never assigned — confirmed.** The value exists only as an enum member (`supabase/migrations/20260806000018_lifecycle_rbac_roles_and_audit_log.sql`, header notes at lines 7-25 explaining it's additive-only). `lib/authz/index.ts:16-21` states plainly: assigning it today has zero enforcement effect, because `is_org_owner()` (`supabase/migrations/20260806000002_organizations_and_members.sql`) still only recognizes the literal string `'owner'`. Every real org-creation path uses `'owner'`.

4. **`client_access_tokens` / `resolveToken` — no rate limiting.** Table: `supabase-client-portal/supabase/migrations/20260814000001_client_portal_token_schema.sql:20-70`. Lookup is a deterministic hash match against a `unique (token_hash)` index; a failed lookup is logged to `client_access_log` but nothing increments a counter, backs off, or locks out repeated guesses. This is a real gap if Gate 5 adds any new externally-reachable token-gated surface (e.g. a drawing-review portal link).

5. **`client_access_log` is write-only today.** No admin/staff UI or query path reads it. The only read found is a test assertion (`lib/bridge/client-portal.live.test.ts:500`). By design it's an append-only accountability ledger (`supabase-client-portal/.../20260814000001...sql:97-100`), but "nothing surfaces it to a human" is worth naming explicitly if Gate 5 needs a staff-visible access trail for drawing review.

6. **`document_revisions` auto-seed + nullable `uploaded_by` — confirmed.** Migration `supabase/migrations/20260806000024_lifecycle_documents_revisions.sql`: a trigger (`application_documents_seed_revision`, around lines 110-179) auto-creates a `document_revisions` row on `application_documents` insert, calling `coalesce(new.uploaded_by, auth.uid())`. `uploaded_by` on `document_revisions` is nullable, so a service-role insert (no `auth.uid()`, no explicit `uploaded_by`) seeds a revision with an unattributed uploader. Relevant to Gate 5 because drawing intake will almost certainly add rows through this same path.

7. **"Credential-isolation binary trigger" — the master prompt's premise is wrong; correcting it.** No DB trigger by this description exists anywhere in `supabase/migrations/`. The actual enforcement is an ESLint rule: `eslint.config.mjs`'s `no-restricted-imports`, described at `lib/bridge/client-portal.ts:9-21` as "the ENTIRE enforced boundary today, not one of two independent layers" — i.e. the client-portal/staff credential boundary is a lint-time guard against a bad import, not a Postgres trigger. This is the same class of correction as the Inngest-queue claim below: treat the master prompt's inventory of "what exists" as a hypothesis to verify, not a fact.

8. **`permit_applications` hard-delete path — real, and RLS-gated, not app-code-gated.** `permit_applications_delete` policy (`supabase/migrations/20260806000006_applications_and_documents.sql:71-73`): `using (is_org_owner(org_id))`. No app code issues a raw DELETE against this table today, but any org owner's Postgres session can, and RLS will allow it — this is a live, unguarded-by-a-confirmation-flow hard-delete surface, consistent with the master prompt's named finding.

---

### §B — Storage

1. Three private Supabase Storage buckets (`lib/storage/documents.ts:36-53`): `permitfield-uploads` (contractor source docs, 25 MB/file cap), `permitfield-generated` (filled PDFs), `permitfield-form-templates` (blank government templates). Path convention: `${orgId}/${applicationId}/${sha256}-${filename}` (`lib/storage/documents.ts:36-44`) — the leading `orgId` segment is load-bearing: Storage RLS extracts it via `storage.foldername(name)[1]` (`supabase/migrations/20260806000013_storage_buckets.sql:11-24, 19-38`).
2. Client-portal upload (`lib/bridge/client-portal.ts`, `uploadDocument`, ~lines 789-938) and staff upload (`app/api/documents/route.ts:21, 84-98`) both validate MIME/size before writing to Storage, then insert into `application_documents`. Duplicate bytes are idempotent via a `(application_id, sha256)` unique constraint (`client-portal.ts:860-866`).
3. Allowed MIME types today: PDF, JPEG, PNG, TIFF only (`lib/storage/documents.ts:10-25`). **No CAD/DWG/DXF/Revit support exists.** Gate 5's "drawing intake" will need either (a) a new allowed-type + conversion step, or (b) an explicit decision that "drawings" means scanned/photographed/PDF-exported drawings only, not native CAD files — this is a scope question for §K, not yet answered.
4. `application_documents.kind` enum already includes `'blueprint'` (`supabase/migrations/20260806000006_applications_and_documents.sql:33`), with a UI label already present (`app/(app)/applications/[id]/document-upload.tsx`). This is a real, already-shipped hook Gate 5 can extend rather than invent.

---

### §C — Background Work (Inngest)

**Correcting the master prompt's "no known durable queue" claim: Inngest is a live, working substrate in this repo today.** Three functions exist in `lib/inngest/functions/`:

| Function | Trigger event | What it does | Client |
|---|---|---|---|
| `permitExtract` (`extract.ts:20-223`) | `permit/application.documents_ready` | Downloads docs, routes text vs. vision, calls Claude, persists `extractions` | service-role |
| `permitAudit` (`audit.ts:20-295`) | `permit/application.extracted` | Retrieves jurisdiction code chunks, calls Claude, persists `audits`/`audit_findings` | service-role |
| `permitGeneratePdf` (`generate-pdf.ts:29-336`) | `permit/application.audited` or `.review_confirmed` | Fills templates, uploads generated PDFs | service-role |

Client setup: `lib/inngest/client.ts:1-60` (`new Inngest({ id: 'permitfield-os' })`, event catalog documented as a hand-typed `PermitEventPayloads` interface since inngest@4.16 dropped compile-time `EventSchemas`). Registered at `app/api/inngest/route.ts:1-14` (exports `GET/POST/PUT` from `inngest.serve({ functions: [permitExtract, permitAudit, permitGeneratePdf] })`).

Conventions worth inheriting into Gate 5's own functions rather than reinventing:
- Idempotency keys are semantic (`applicationId` for extract/pdf-gen — collapses concurrent retries onto the same row; `extractionId` for audit — allows a fresh audit per extraction).
- `retries: 2` on all three; that's network/5xx retry only — a structurally-invalid model response is retried once *inside* the function body (see §G), then fails closed, never re-thrown for Inngest to retry blindly.
- `step.run()` splits each function into memoized steps specifically so a mid-run failure doesn't re-execute (and re-insert) already-completed steps on retry (`extract.ts:131-140`, `audit.ts:153-164`).
- **No notification consumer exists.** Every event is emitted via `step.sendEvent()`; `client.ts:29-30` states in-repo: "no subscriber exists yet... Phase 5's UI/notifications are the intended future consumer." This is Gate 5's most direct, already-prepared integration point — §F below is built on the assumption that notification-sending is a *new* Inngest function subscribing to these existing events, not a parallel system.

---

### §D — Forms & PDF

1. `lib/pdf/text-density.ts` (1-63): decides text vs. vision routing per document — extracts text via `pdf-parse`, computes chars/page, routes to `'vision'` below a 40 chars/page threshold or on parse failure, else `'text'`.
2. `lib/pdf/fill-acroform.ts` (1-59): fills named AcroForm fields via `pdf-lib`; throws loudly on a missing/non-text field rather than silently skipping (lines 44-51) — a template/seed-data mismatch is treated as a bug, not a soft failure.
3. `docs-reference-forms/` holds 9 real government PDF forms (Toronto, Calgary, Surrey, Vancouver, Coquitlam, ESA-ICIA, Maple Ridge, Port Coquitlam, Richmond) used for Phase 0-era template inspection — a useful existing corpus of real drawing-adjacent intake forms to test Gate 5's extraction against.
4. **No OCR/tesseract, no CAD parsing anywhere.** What exists instead is vision-routing straight to Claude: `lib/ai/extract-permit-data.ts` sends PDF bytes as base64 in an Anthropic `document` content block (confirmed directly, see §G.6) rather than running a separate OCR pass. For Gate 5 this means "vision-route a drawing PDF/image to Claude" is already a proven pattern, not new infrastructure — the new work is the *citation* granularity (page/region) and the *code-matching* step, not the transport.
5. **Evidence/citation pattern already exists and is exactly the shape Gate 5's master prompt asks for.** Extraction schema (`lib/ai/schemas/extraction.ts:17-24`): every field carries `value`, `confidence`, `source_document_id`, `source_page` — validated post-hoc against the actual documents shown to the model (`findInvalidSourceCitations`, `lib/ai/extract-permit-data.ts:113-124`). Audit schema (`lib/ai/schemas/audit.ts:27-44`): every finding carries `kind`, `code_chunk_id` (required unless `kind==='missing_document'`, enforced by a Zod `.refine()`, lines 41-44) — validated per-item against the retrieved-chunk allowlist (`validateAuditFindingItem`, `lib/ai/audit-permit-data.ts:264-290`). Gate 5's "evidence-linked extraction" and "scoped code pre-review" requirements are, structurally, a **generalization of a pattern that's already built and battle-tested for permit-data extraction/audit** — this is the single biggest scope-reducer for Gate 5's plan.

---

### §E — Jurisdictions

1. `JURISDICTION_EXPANSION_SCOPE.md` is a research/prioritization doc, not a shipped spec — but its downstream seed data **is** shipped: 10 Canadian jurisdictions now have `jurisdictions`/`authorities` rows (up from an original 4), including Surrey, Vancouver, Richmond, Coquitlam, Port Coquitlam, Maple Ridge BC.
2. `jurisdictions` schema (`supabase/migrations/20260806000004_jurisdictions_and_authorities.sql:21-34`): `country`, `province_code`, `municipality`, `region`, `unit_system`, `portal_url`, `coverage_level` (`'verified'|'assisted'|'listed'`), `verified_at`. `authorities` (lines 36-46): `authority_level`, `filing_mechanism`, optional `jurisdiction_id` FK (nullable, to support province-wide agencies like Ontario's ESA with no single municipality).
3. No staff UI exists to explicitly pick a jurisdiction during intake — it's implicit via the `permit_type_id` FK chosen at application creation (`app/(app)/applications/new`). Gate 5's "scoped code pre-review" needs jurisdiction scope resolved *before* running code checks; today that resolution is a side effect of permit-type selection, not a first-class step.
4. `jurisdiction_code_chunks` (`supabase/migrations/20260806000008_jurisdiction_code_chunks.sql:14-50`) and `jurisdiction_sources` (`supabase/migrations/20260806000021_jurisdiction_sources.sql:93-176`, added Gate 1.2) are both jurisdiction-level only — **no column ties a code chunk to a permit type or a drawing category** (structural vs. electrical vs. zoning). `jurisdiction_sources` has zero call sites (schema exists, nothing writes/reads it yet — same "declared ahead of use" pattern as several flags). Gate 5's "scoped" pre-review will need a new dimension (permit-type or drawing-category tagging on code chunks) that doesn't exist yet; migration `20260806000037` already added nullable `permit_type`/`property_type`/`language` columns to `jurisdiction_code_chunks` per the AI pipeline research (§G.7), which is a head start but not a drawing-category taxonomy.
5. Corpus is still empty by design — no ingestion pipeline exists (confirmed in §G.7). Any Gate 5 sub-phase depending on real code-chunk retrieval is blocked on corpus ingestion, independent of anything Gate 5 itself builds.

---

### §F — Notifications

**Zero notification infrastructure exists.** Confirmed by exhaustive search: no Resend/SendGrid/Postmark/nodemailer, no `notifications`/`email_log`/`notification_queue` table, no SMS, no webhook-out. `.env.example` declares Inngest and Stripe webhook secrets but nothing for outbound email.

`client_access_tokens` already carries recipient identity (`recipient_email`, `recipient_email_display`, `recipient_name` — `supabase-client-portal/.../20260814000001...sql:42-45`), but those fields are used only for display (audit-log `external_actor_label`, admin token-list UI) — **no email is ever sent** when a token is issued/revoked or a document/status changes. `issueToken()` (`lib/bridge/client-portal.ts:1037-1162`) returns the raw token once to the admin caller with an explicit "the admin copies it by hand" comment — there is no automated delivery path today, at all.

As noted in §C, every Inngest event this repo emits is already unconsumed and explicitly earmarked ("Phase 5's UI/notifications are the intended future consumer," `lib/inngest/client.ts:29-30`) for exactly this gate. Building notifications as new Inngest subscribers to `permit/application.extracted` / `.audited` / `.pdf_generated` (plus new Gate-5-specific events) is the path of least resistance and matches what the code already expects.

---

### §G — AI

1. **Model & config**: `MODEL_ID = 'claude-sonnet-5'` (`lib/ai/config.ts:8`, explicitly not `claude-3-5-sonnet` per an in-file comment warning against reverting it). `EXTRACTION_MAX_TOKENS=4096`, `AUDIT_MAX_TOKENS=8192`, both with `MAX_VALIDATION_ATTEMPTS=2` (retry-once-on-schema-failure, then fail closed — `lib/ai/config.ts:14-45`). `AUDIT_MAX_RETRIEVED_CHUNKS=8` (`config.ts:60`).
2. **Multi-document / multi-page handling** (`lib/ai/extract-permit-data.ts:45-229`): tool name `record_permit_extraction`, JSON Schema generated from the Zod schema via `z.toJSONSchema()`. Documents route per-item to `'text'` (raw text injected) or `'vision'` (base64 PDF/image bytes injected as an Anthropic `document`/image content block) based on `text-density.ts`'s verdict — confirmed directly at `extract-permit-data.ts:94-98`, the vision branch sends `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesBase64 } }`. **This confirms Claude already receives raw drawing bytes today when a document is scanned/image-heavy** — Gate 5 doesn't need to build a new transport, only new prompts/schemas and finer-grained citations (region/bounding-box, not just page number).
3. **Citation-boundary enforcement, extraction**: `findInvalidSourceCitations()` (`extract-permit-data.ts:113-124`) rejects any `source_document_id` not in the exact set of IDs shown to the model that call.
4. **Citation-boundary enforcement, audit**: `validateAuditFindingItem()` (`audit-permit-data.ts:264-290`) — three ordered checks: `kind==='missing_document'` findings are computed deterministically and never trusted from the model (lines 268-272); every other finding's `code_chunk_id` must be in the retrieved-chunk allowlist (274-279); then Zod shape validation (281-286). Failures drop that one finding into `ai_findings_rejected` rather than failing the whole batch.
5. **Embeddings**: Voyage AI, `voyage-3`, 1024 dims (`lib/ai/config.ts:53-54`, `lib/ai/embed.ts` raw `fetch()` call, no SDK, 30s timeout). Gated by `isVectorRetrievalEnabled()` (default OFF — `lib/flags.ts:26-30`); BM25 (`content_tsv`) retrieval runs regardless.
6. **Retrieval**: `retrieveCodeChunks()` (`lib/ai/retrieve-code-chunks.ts`) calls the `search_jurisdiction_code_chunks` RPC (migration `20260806000014`), RRF-fusing BM25 + optional vector, capped at 8 chunks, filterable by jurisdiction/permit_type/property_type/language/as-of-date (staleness enforcement).
7. **Corpus state**: `jurisdiction_code_chunks` is empty — no ingestion pipeline exists (confirmed both directly and by sub-agent search; `retrieve-code-chunks.ts`'s own header comment states "no VOYAGE_API_KEY available here, and no corpus ingestion pipeline exists yet"). This is an existing, pre-Gate-5 blocker, not something Gate 5 introduces — see §J.

---

### §H — Flags, Entitlements, Audit, Tests

1. **Flag convention** (`lib/flags.ts:12-13`): a single `isEnabled(envVarName)` helper, `process.env[X] === 'true'` exactly, re-read on every call (not cached), so any other value — unset, `"false"`, `"0"`, a typo — resolves OFF. Every gate follows this: `isAiAuditEnabled` (`flags.ts:21-23`), `isVectorRetrievalEnabled` (`:26-30`), `isPdfFillEnabled`, `isBillingEnabled`, etc. Gate 5 should add its own `PERMITFIELD_FF_DRAWING_REVIEW`-style flag(s) the same way, default OFF.
2. **Entitlements** (`lib/entitlements/index.ts`, `lib/billing/tiers.ts:20-26`): `Entitlement` union is `'projects.create' | 'readiness.checker' | 'readiness.override' | 'jurisdiction.requirements' | 'analytics' | 'ai'`. Note an `'ai'` entitlement **already exists** — this pre-empts Gate AI-1 open-question Q4 (see §I) rather than needing a new decision; whether Gate 5's new capabilities should gate on this existing `'ai'` key or need their own is now the live question, not whether to invent a flat key. `resolveEffectiveTier()` is pure/DB-free and unit-tested directly (`lib/entitlements/index.test.ts:19-155`) — the pattern any new Gate 5 entitlement logic should follow. Enforcement call sites remain sparse: `app/(app)/projects/new/actions.ts:80,99` are the only two found.
3. **Audit log call sites, reconciled**: `writeAuditLog()` (`lib/audit/log.ts:74-105`) has exactly two call sites *on this branch* (based on `main`): `app/(app)/projects/new/actions.ts:155` (internal actor) and `lib/bridge/client-portal.ts:970` (external actor). **This does not contradict Gate AI-1's findings** — it reconciles a false alarm: the additional `change-orders.ts`/`credit-notes.ts` call sites from this session's Gate 4 Phase B work live on the still-unmerged branch `feat/gate-4-phase-b-change-orders-credit-notes` (in a separate worktree), not on `main`, so they correctly don't appear here. Worth flagging as a merge-ordering dependency: once Gate 4 lands on `main`, this count grows by 2, and any Gate-5-authored audit-log-count assumption should be re-checked at that point rather than trusted from this doc.
4. **Test pattern to reuse**: `lib/quotes-payments/*.test.ts`'s `FakeSupabaseClient`/`ok()`/`dbError()` fixture (also not present on `main` yet, for the same branch reason as #3, but real and mergeable) is the established convention; on `main` today, the equivalent pattern is pure-function unit tests with no Supabase mock at all (`lib/entitlements/index.test.ts`) plus separate `*.live.test.ts` files that hit a real service-role Supabase client (`lib/audit/log.live.test.ts:28-145`). SQL-level tests exist too: `supabase/tests/audit_logs_external_actor.test.sql` uses a control-then-assert pattern (drop constraint, prove it *would* have failed, restore constraint, prove it now does).
5. **Existing findings-doc inventory** (repo root): `PHASE_0_FINDINGS.md`, `PHASE_0_FINDINGS_ORIGINAL_MISSION.md`, `GATE_2_0_FINDINGS.md` (client portal, built), `GATE_3_0_FINDINGS.md` (corrections/resubmissions, scoping-only, resolved below), `GATE_AI_1_FINDINGS.md` (AI routing/provider, scoping-only, resolved below), `LP_PHASE_0_FINDINGS.md`, `SERVICE_ROLE_GRANTS_FINDINGS.md`, `TRUNCATE_HARDENING_FINDINGS.md`, `MARKETING_PHASE_0_FINDINGS.md`.

---

### §I — Inherited Open Findings

#### I.1 — Gate AI-1's five open questions, resolved per Ren's go-ahead ("solve the unresolved... AI-1")

| # | Question (from `GATE_AI_1_FINDINGS.md`) | Resolution |
|---|---|---|
| Q1 | Is a findings pass sufficient, or is a separate decision doc needed? | Findings pass is sufficient. This document (and the prior in-chat exchange) stands as the decision record; no separate doc will be produced. |
| Q2 | Should existing Claude extraction/audit be replaced by a new provider/router? | No. Existing Claude-based extraction/audit (`lib/ai/extract-permit-data.ts`, `audit-permit-data.ts`) stays exactly as-is. Any future multi-provider router is scoped strictly to *new* capabilities Gate 5 (or a later gate) introduces that Claude can't cover — it is additive, never a replacement of what's proven. |
| Q3 | Keep Voyage AI embeddings, or switch provider? | Keep Voyage AI (`voyage-3`, 1024 dims). No change. |
| Q4 | What entitlement key gates AI features? | Moot as originally framed — `'ai'` already exists in the `Entitlement` union (`lib/billing/tiers.ts:24`, confirmed §H.2). Gate 5 reuses this key rather than inventing a new one; if Gate 5 needs finer-grained gating later, that's a new, additively-named key (e.g. `'ai.drawing_review'`), not a replacement. |
| Q5 | Should human sign-off events also write through `writeAuditLog()`? | Yes. Any human confirm/reject/override step Gate 5 introduces (e.g. a staff reviewer accepting/rejecting an extracted drawing finding) writes an audit-log entry via the existing internal-actor shape, same as every other lifecycle action in this repo. |

#### I.2 — Gate 3.0, resolved per Ren's go-ahead

Gate 1.3's DB-level groundwork (`permit_status_enum` already including `revision_requested`, `resubmitted`, `appeal_filed`, plus three unenforced evidence columns — `supabase/migrations/20260806000022_permit_status_machine.sql:90-107`) **is confirmed as the intended foundation** for a future corrections/resubmissions gate. Resolution: corrections/resubmissions stays **staff-side only for now, marked "ready to spec, not scheduled,"** keeps its own future gate number (not reusing "3.0", per the master prompt's explicit constraint), and is **explicitly not folded into Gate 5** — it's a different workflow stage (post-decision correction loop) from drawing intake/extraction/pre-review (pre-submission), and bundling them would blur Gate 5's own scope for no shared-code benefit found in this Phase 0 pass.

#### I.3 — Master prompt's 9 named inherited findings, current status

1. `OrgContext.role` typing gap — confirmed live, §A.2.
2. `org_owner` never assigned — confirmed live, §A.3.
3. `document_revisions` auto-seed + nullable `uploaded_by` — confirmed live, §A.6.
4. Credential-isolation "trigger" — **corrected**: it's an ESLint import rule, not a DB trigger, §A.7.
5. `client_access_log` read path — confirmed absent (write-only), §A.5.
6. Rate limiting on `resolveToken` — confirmed absent, §A.4.
7. `permit_applications` live hard-delete path — confirmed live (RLS-gated, not app-gated), §A.8.
8. "No known durable queue" — **corrected**: Inngest is live and directly reusable, §C.
9. `lib/bridge/client-portal.ts` "imported by nothing" (from Gate AI-1) — **superseded, not contradicted**: on `main` (this branch's base) it still has exactly one real caller path plus its own test files; the additional Gate-4 callers this session added live on an unmerged branch (§H.3). Once that branch merges, this claim will need re-checking again — it is not evergreen.

None of these 9 items are blockers to starting Gate 5.1; all are pre-existing conditions Gate 5's own code should be written to not make worse (e.g. don't add a second untyped role literal on top of finding #1; do add rate limiting if Gate 5 introduces a new external token-gated surface per finding #6).

---

### §J — Blockers

1. **Empty jurisdiction code-chunk corpus, no ingestion pipeline** (§E.5, §G.7). Any sub-phase that needs real "scoped code pre-review" against actual bylaw text is blocked until a corpus-ingestion workstream exists — this predates Gate 5 and isn't something Gate 5 can unblock by itself without scope creep into jurisdiction-data acquisition.
2. **No drawing-category taxonomy on code chunks** (§E.4). "Scoped" pre-review implies scoping by drawing type (structural/electrical/mechanical/zoning); no such dimension exists on `jurisdiction_code_chunks` today beyond the newer nullable `permit_type`/`property_type` columns, which are permit-level, not drawing-category-level.
3. **No CAD/DWG/DXF support** (§B.3) — a scope decision is needed on whether "drawings" means only scanned/rasterized/PDF-exported drawings (buildable today on top of existing vision-routing) or native CAD files (would require new parsing infrastructure this repo has none of).
4. **Notifications have zero infrastructure, including no email provider** (§F) — Gate 5 cannot ship "notifications" without first choosing and wiring an outbound email provider (or SMS/webhook), which is a new external dependency, not just new application code.
5. **Merge-ordering dependency on Gate 4 Phase B** (§H.3, §I.3 item 9) — several counts/claims in this document (audit-log call sites, `client-portal.ts` import graph) will shift once `feat/gate-4-phase-b-change-orders-credit-notes` merges to `main`. Not a blocker to *starting* Gate 5, but worth re-verifying before Gate 5's own code touches those same files.

---

### §K — Proposed Sub-Phase Plan

Given §A-§J, the highest-leverage path is to treat Gate 5 as **extending the existing extraction/audit pipeline**, not replacing or parallel-building it:

- **5.1 — Schema & RLS.** New tables only (additive): a drawing-specific evidence/citation table (page + region/bounding-box, generalizing `source_page`), a drawing-category taxonomy on `jurisdiction_code_chunks` (or a join table, to avoid an unbounded ALTER), and any new lifecycle status columns needed for a "pre-review" result distinct from the existing `audits`/`audit_findings`. RLS mirrors existing `is_org_member`/service-role patterns. SQL tests (pgTAP-style, per §H.4) required before moving on.
- **5.2 — Service layer + Inngest function(s).** A new `permit/application.drawing_intake_ready`-style event and Inngest function, reusing the vision-routing (`text-density.ts`) and citation-validation (`findInvalidSourceCitations`-equivalent) patterns from extraction/audit rather than reinventing them. Explicitly scoped to Claude only (per I.1 Q2) — no new AI provider.
- **5.3 — Notifications.** New Inngest subscriber(s) on the *existing* unconsumed events (`permit/application.extracted`/`.audited`/`.pdf_generated`) plus Gate 5's own new event(s), fanning out to a newly-chosen email provider. This is explicitly gated behind Ren choosing a provider (§J.4) before code starts.
- **5.4 — Staff UI + client-portal surfacing.** Drawing upload/review UI for staff; a portal-side view for the client, reusing `lib/bridge/client-portal.ts` conventions and adding rate limiting to `resolveToken` (§A.4) if this is the surface that finally needs it.
- **5.5 — Corpus/taxonomy dependency check-in.** Not new Gate 5 code — a checkpoint to confirm whether jurisdiction code-chunk ingestion (§J.1) has progressed enough to make "scoped pre-review" produce real findings rather than structurally-correct-but-empty results.

Each sub-phase still requires its own `APPROVED: PHASE 5.<n>` token before code is written, per the master prompt's standing rule. Recommended order is 5.1 → 5.2 → 5.4 → 5.3, with 5.5 as a standing gate-check rather than a sequential step, but Ren's call.

---

**Phase 0 complete. Stopping here per the master prompt's rule — no migrations, code, or UI have been written. Awaiting `APPROVED: PHASE 5.<n>` for a specific sub-phase.**
