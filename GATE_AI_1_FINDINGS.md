# Gate AI-1 — Phase AI-1.0 Findings (read-only)

Scope: PermitField OS only. Gate AI-1 is a separately-numbered workstream —
it does not touch Gate 3.0's enum values or evidence columns, and nothing
below proposes changes to either.

## §0. Blocking precondition: `PERMITFIELD_AI_MODEL_DECISION.md` does not exist

The prompt names `PERMITFIELD_AI_MODEL_DECISION.md` as "source of truth for
every model, pricing, and control decision in this prompt" and instructs
reading it first. A full-repo search (`find . -iname "*AI_MODEL_DECISION*"`,
excluding `node_modules`/`.git`) returns zero matches. It is not present
under any name in this repository at the commit this findings pass was run
against (`main`, `7044adb`).

This is reported, not resolved. §A–§H below are a factual account of what
exists in the codebase today and do not depend on the decision doc's
contents. But §G's model-ID table, AI-1.4's 2026/2027 rate figures, and any
per-task-kind routing table in this prompt cannot be verified against a
source of truth that isn't in the repo — see the numbered questions at the
end.

## §A. Current AI provider

**Finding: this is not greenfield. A real, working Anthropic Claude
integration already exists, with two live call sites and no
provider-abstraction interface.** Switching to Gemini is **(b) a rewrite of
call sites**, not a new adapter behind an existing seam — there is no seam.

- `@anthropic-ai/sdk ^0.115.0` is a direct `package.json` dependency
  (`package.json:18`). No Gemini SDK or REST client exists anywhere in the
  repo (`grep -rl "gemini\|Gemini"` returns zero matches outside this
  prompt's own text).
- **Model ID**: single source of truth is `MODEL_ID = 'claude-sonnet-5'`
  (`lib/ai/config.ts:8`). Every model call in the repo imports this constant;
  no call site inlines a model string.
- **Two live call sites**, both structured identically (Anthropic SDK
  `client.messages.create()` with a forced tool-use call, not a chat
  completion):
  - `lib/ai/extract-permit-data.ts:137-228` (`extractPermitData`) — called
    from `lib/inngest/functions/extract.ts:126-129`, which constructs
    `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` inline at
    `extract.ts:127`.
  - `lib/ai/audit-permit-data.ts:136-251` (`auditPermitData`) — called from
    `lib/inngest/functions/audit.ts:148-151`, same inline-client pattern at
    `audit.ts:149`.
  - Both files import `Anthropic` directly and type every message/tool
    param as `Anthropic.Messages.*` (`extract-permit-data.ts:1,75-176`;
    `audit-permit-data.ts:1,102-190`) — Anthropic's tool-use request/response
    shape is baked into the function signatures themselves, not hidden
    behind a generic `ProviderClient` interface. There is no
    `lib/ai/provider.ts` or equivalent abstraction anywhere in `lib/ai/`.
  - A third caller exists only in test/eval code:
    `eval/run.ts:28,130-141,448` constructs an `Anthropic` client for a
    live extraction-accuracy check that runs only when `ANTHROPIC_API_KEY`
    is set (`eval/run.ts:441-448`), and separately builds a fake
    `Anthropic`-shaped object to prove `auditPermitData` never touches the
    client when `retrievedChunks` is empty (`eval/run.ts:130-141`).
- **Embeddings**: Anthropic serves no embeddings endpoint, so retrieval's
  vector half uses **Voyage AI** (`voyage-3`, 1024 dims) via a hand-rolled
  REST client (`lib/ai/embed.ts:1-88`), not an SDK. This is a second
  provider integration already in the repo, structurally separate from the
  Anthropic call sites, that a Gemini migration would also need to decide
  about (Gemini does have an embeddings endpoint — out of scope for this
  read-only pass to recommend, flagged as a question in §-end).
- **Conclusion for AI-1.1 scoping**: "Provider adapter for Gemini... server
  only" as specified in this prompt is achievable, but it will sit
  *alongside*, not *behind*, the existing Anthropic call sites unless AI-1.1
  also refactors `extract-permit-data.ts`/`audit-permit-data.ts` to go
  through the new adapter. The prompt does not say whether extraction/audit
  move to Gemini or stay on Claude — this is a real open question, not an
  implementation detail (see questions).

## §B. Requirements data

- **`jurisdictions`** (`supabase/migrations/20260806000004_jurisdictions_and_authorities.sql:14-28`):
  `country`, `province_code`, `municipality`, `region`, `unit_system`,
  `portal_url`, `coverage_level`, `verified_at`. No `permit_type`,
  `property_type`, or `language` column — those live one level down or not
  at all.
- **`authorities`** (same migration, lines 30-40): `jurisdiction_id`
  (nullable, for province-wide authorities), `filing_mechanism`.
- **`permit_types`** (`20260806000005_permit_types_and_filings.sql:6-16`):
  `jurisdiction_id`, `title`, `compliance_rules jsonb`, `version`,
  `verified_at`, `verified_by`. Permit-type indexing exists here, at the
  jurisdiction/permit-type join level — but **not** on the retrieval corpus
  table (next bullet).
- **`jurisdiction_code_chunks`** (`20260806000008_jurisdiction_code_chunks.sql:13-27`)
  — this is the RAG corpus table, and it is indexed **only by
  `jurisdiction_id`** (`jurisdiction_code_chunks_jurisdiction_id_idx`, line
  25). There is **no `permit_type`, `property_type`, or `language` column on
  this table at all.** A retrieval query today can filter to a jurisdiction;
  it cannot filter to "the passages relevant to this permit type" or
  "in French" — that filtering, if it happens at all, would have to happen
  in the calling code after retrieval, and nothing does that today.
- **Effective-date / revision-date columns**: `jurisdiction_code_chunks` has
  exactly one date column, **`effective_date date`, nullable**
  (`20260806000008...sql:20`), passed through unchanged by
  `search_jurisdiction_code_chunks` (`20260806000014...sql:54,99`). There is
  **no `revision_date` column anywhere in the schema** (grep across all
  migrations for `revision_date`/`effective_from`/`effective_to` returns
  zero matches outside AI-1.2's own proposed shape in this prompt). A
  separate, unrelated table — `jurisdiction_sources`
  (`20260806000021_jurisdiction_sources.sql`) — tracks `verified_at` and a
  computed staleness status (`lib/jurisdictions/staleness.ts:38,48-66`,
  180-day default threshold) for *jurisdiction-level source documents*
  (fee schedule, forms page, bylaw link), but this is a completely separate
  system from `jurisdiction_code_chunks`: nothing in
  `lib/ai/retrieve-code-chunks.ts` or `search_jurisdiction_code_chunks`
  consults `jurisdiction_sources` or its staleness computation. A stale
  jurisdiction source does not prevent its corresponding code chunk (if one
  even exists — no FK links the two tables) from being retrieved and cited.
- **pgvector**: provisioned (`create extension if not exists vector;`,
  `20260806000001_extensions.sql:4`) and schema-wired
  (`jurisdiction_code_chunks.embedding vector(1024)`,
  `20260806000008...sql:23`, `ivfflat` index at line 26), but **empty and
  unused in practice**: `retrieveCodeChunks`'s own header comment states
  plainly that "no ingestion pipeline exists yet in any phase, so there are
  zero real chunks to retrieve regardless" (`lib/ai/retrieve-code-chunks.ts:52-55`),
  and the vector half is additionally gated behind
  `isVectorRetrievalEnabled()` (`lib/flags.ts:30-32`), which defaults OFF.
  Today only BM25 (`content_tsv`, GIN-indexed) actually runs.

## §C. Retrieval boundary

A real boundary exists, but only inside the audit engine, and only against
the (currently empty) `jurisdiction_code_chunks` corpus:

- `retrieveCodeChunks` (`lib/ai/retrieve-code-chunks.ts:61-100`) calls
  `search_jurisdiction_code_chunks` (`20260806000014...sql:36-99`), which is
  the only path that reaches the corpus — no call site queries
  `jurisdiction_code_chunks` directly via `.from()`.
- The model is shown only the chunks this function returns, each introduced
  with an explicit chunk ID (`lib/ai/audit-permit-data.ts:99-116`), and the
  system prompt instructs it to cite only shown IDs
  (`audit-permit-data.ts:38-40`).
- **The boundary is enforced in application code, not trusted from the
  prompt alone**: `validateAuditFindingItem`
  (`lib/ai/audit-permit-data.ts:264-289`) checks every returned
  `code_chunk_id` against the exact set of IDs shown that call
  (`validChunkIds`, built at line 159) and drops (does not persist as a
  valid finding) anything that doesn't match, or that has a null
  `code_chunk_id` for a non-`missing_document` kind
  (`lib/ai/schemas/audit.ts:41-44`, a Zod `.refine()`). This is a real,
  tested (`eval/run.ts` exercises this exact function per its own header
  comment) citation boundary.
- An analogous, weaker boundary exists on the extraction side (not
  retrieval, but the same "can't cite what it wasn't shown" shape):
  `findInvalidSourceCitations` (`lib/ai/extract-permit-data.ts:113-124`)
  checks `source_document_id` against the documents actually sent in that
  call.
- **What does not exist**: there is no retrieval path over an org's own
  uploaded `application_documents` at all — no embedding, no chunking, no
  vector/BM25 index over uploaded PDFs. The only retrieval corpus today is
  the public, jurisdiction-wide `jurisdiction_code_chunks` table, whose RLS
  is not org-scoped (`license_status = 'public_record'` is the only filter,
  `20260806000008...sql:34-40`) because it isn't tenant data. AI-1.2's own
  scope line — "Retrieval query filters to the caller's org (for uploaded
  docs) plus public jurisdiction sources" — describes a capability that
  does not exist in any form today; it is new construction, not an
  extension of an existing org-scoped retrieval path.

## §D. Document ingestion

- **`pdf-parse`** (`^2.4.5`) is used in exactly one place:
  `lib/pdf/text-density.ts:1,32-59` (`computeTextDensity`), which decides
  per-document whether to route to Claude's text path or vision path based
  on extracted-text density (`MIN_CHARS_PER_PAGE_FOR_TEXT_ROUTE = 40`,
  line 13). It does not classify document *kind* — only text-vs-scanned.
- **`pdf-lib`** (`^1.17.1`) is used for form-filling
  (`lib/pdf/fill-acroform.ts`, `lib/pdf/resolve-fields.ts`,
  `lib/pdf/overlay-coordinates.ts`) — the PDF-generation direction, not
  ingestion/extraction. Not part of the AI extraction path.
- **`application_documents` flow**: uploaded via
  `app/api/documents/route.ts` under the caller's own session (`RLS`
  applies — the file's own header comment at lines 14-18 explicitly says
  "Never import lib/supabase/service-client.ts here"). `doc_kind` is
  **user-supplied at upload time**
  (`app/api/documents/route.ts:19-23`, `DOC_KINDS` const, passed through to
  the insert at line 150) — there is **no automated classification step
  today**. AI-1.3's "Classification and field extraction on document
  upload" would be genuinely new capability, not a replacement of an
  existing classifier (there isn't one).
- **Where extraction/audit jobs hook in today**: `permitExtract`
  (`lib/inngest/functions/extract.ts:20-27`) triggers on
  `permit/application.documents_ready`, downloads each document from the
  `UPLOADS_BUCKET` Storage bucket, routes it (text/vision), and calls
  `extractPermitData`. `permitAudit`
  (`lib/inngest/functions/audit.ts:20-27`) triggers on
  `permit/application.extracted` and calls `auditPermitData`. Both are
  Inngest functions using `createServiceClient()`
  (`extract.ts:3,30`; `audit.ts:3,31`). This is the natural hook point for
  AI-1.3's classification/extraction batch jobs — same trigger pattern,
  same service-role client.
- **The `service_role` INSERT grant from 2.3** (`grant insert on
  application_documents to service_role;`,
  `20260806000031_application_documents_service_role_insert.sql:47`,
  its own header explains this was added for the client-portal bridge's
  `uploadDocument`, not for AI jobs) — **AI jobs do not need it and do not
  use it**. `extract.ts`/`audit.ts` only `SELECT`/`UPDATE`
  `application_documents` (they read existing rows and write
  `text_layer_chars`), which was already granted separately and earlier
  (`grant select, update on application_documents to service_role;`,
  `20260806000015_service_role_grants.sql:27`). If AI-1.3's classification
  job ever needs to *insert* new document rows (e.g. a derived/split
  document), it would need its own explicit grant, following this repo's
  stated "explicit grants only, scoped to what the code actually does"
  convention (`20260806000015...sql:19-21`) — not reuse of the 2.3 grant,
  which is scoped to a different caller.

## §E. Audit and ledger

- **`writeAuditLog()`** (`lib/audit/log.ts:74-105`). **Correction to this
  prompt's premise**: as of `main`@`7044adb`, there are **two** real call
  sites, not one:
  - `app/(app)/projects/new/actions.ts:155` (internal-actor shape, Phase
    1.1 project-intake flow).
  - `lib/bridge/client-portal.ts:923` (external-actor shape, Gate 2.0
    sub-phase 2.5's `uploadDocument`).
  - `lib/audit/log.ts`'s own header comment (lines 6-13) describes 2.5 as
    "this function's first real call site" while also acknowledging the
    `actions.ts` caller exists — the header is internally consistent (it
    means "first call site as of Gate 2.0," not "only call site now"), but
    a reader taking this prompt's "there was exactly one after Gate 2.0" at
    face value would be off by one today. Neither call site is AI-related;
    both are human-actor-initiated.
- **`audit_logs.org_id` is `NOT NULL`** — confirmed at
  `20260806000018_lifecycle_rbac_roles_and_audit_log.sql:48` (`org_id uuid
  not null references organizations(id) on delete cascade`). Every AI job
  today (`extract.ts`, `audit.ts`) operates on a `permit_applications` row,
  and `permit_applications.org_id` is itself `NOT NULL`
  (`20260806000006_applications_and_documents.sql:19`) — so an AI event
  keyed to an `applicationId` always has a resolvable `org_id` via a join,
  the same way `writeAuditLog`'s existing callers resolve theirs from
  their own request context. A future `ai` audit-log write (or the
  proposed `ai_jobs`/`ai_token_ledger` tables carrying their own `org_id`
  column directly, avoiding a join at write time) would not hit a
  null-org_id case for any AI job whose trigger event already carries an
  `applicationId` — this would need re-checking if a task kind is ever
  introduced that has no application/org context at all (e.g. a purely
  internal corpus-ingestion job).
- **Whether AI events reuse `audit_logs` or need a sibling table**: the
  existing table's own header comment draws the line explicitly —
  `audit_logs` "records *what a human (or a background job acting on a
  human's behalf) did*" as distinct from the domain-specific append-only
  tables (`extractions`, `audits`, `audit_findings`) that "record *what the
  AI produced*" (`20260806000018...sql:35-38`). Under that existing
  convention, `ai_token_ledger`/`ai_jobs` (recording what a model call
  cost/did) are a **sibling table**, following the `extractions`/`audits`
  append-only pattern (`SELECT`+`INSERT`-only RLS, `forbid_update_delete()`
  trigger — see `20260806000018...sql`'s own reuse of that pattern, lines
  38-40), not a repurposing of `audit_logs` itself. A **human sign-off
  event** on a Pro escalation (AI-1.4's "held until a reviewer marks it
  released") is arguably a human *action* in the `audit_logs` sense and
  could reasonably go through `writeAuditLog()` in addition to updating
  `ai_human_reviews` directly — flagged as a design choice for AI-1.1/AI-1.4,
  not resolved here.

## §F. Entitlements

- `lib/entitlements/index.ts:63-68` defines `Entitlement` as a flat string
  union with a `resource.action` dot-namespace convention (established by
  the original `projects.create` key, extended by `readiness.checker`,
  `readiness.override`, `jurisdiction.requirements`), **except**
  `'analytics'`, added in Gate 1.7 as a single flat key with no dot,
  because the master prompt's own spec spelled it that way verbatim
  (line 53-54 comment).
- Every key today has **zero enforcement call sites** except
  `projects.create` (`app/(app)/projects/new/actions.ts`, per the module
  header, line 22-26) — this is a consistent "declared now, enforced at the
  future call site" pattern (`lib/flags.ts` follows the identical
  discipline for its own flags).
- `can(orgId, entitlement)` and `limit(orgId, key)`
  (`lib/entitlements/index.ts:98-106`) both accept `orgId` but never branch
  on it — there is exactly one hardcoded `DEFAULT_TIER` (lines 79-91) every
  org resolves to. This is explicitly not a real billing system (module
  header, lines 4-18).
- **Proposed `ai` key**, following the `analytics` precedent (flat, no dot,
  since the prompt's task kinds — routing, assistant, token caps — are
  sub-capabilities of one gate rather than independent resources the way
  `readiness.checker`/`readiness.override` are two genuinely separate
  actions):
  ```ts
  export type Entitlement =
    | 'projects.create'
    | 'readiness.checker'
    | 'readiness.override'
    | 'jurisdiction.requirements'
    | 'analytics'
    | 'ai';
  ```
  Added to `DEFAULT_TIER.features` alongside the existing five, same as
  every prior key. If a future need arises to gate the Pro-escalation path
  independently from the base assistant (e.g. only certain roles can
  trigger `escalate`), that would need a second key (`ai.escalate`,
  breaking the flat-`analytics`-style precedent in favor of the dot
  convention) — flagged as a possible AI-1.4 follow-up, not built now.

## §G. Sub-phase plan AI-1.1 → AI-1.4, with per-migration blast radius

All migrations below are additive-only, following this repo's established
convention (no existing column/table/enum value altered or removed;
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` for enum extension, never
`RENAME VALUE`, per `20260806000018...sql`'s own header rationale).

**AI-1.1 — Adapter, router, schema**
- New tables: `ai_jobs`, `ai_token_ledger` (append-only, integer, RLS —
  should reuse the `extractions`/`audits` append-only pattern: `SELECT`+
  `INSERT`-only policy, `forbid_update_delete()` trigger, and an explicit,
  narrow `service_role` grant added the same way
  `20260806000015...sql`/`20260806000031...sql` were — never a blanket
  grant), `ai_human_reviews`.
- Blast radius: **low**. New tables only; no existing table touched. The
  one genuine risk is RLS scoping — `ai_jobs`/`ai_token_ledger` need an
  `org_id NOT NULL` column and org-scoped `SELECT` policy from day one
  (mirroring `audit_logs.org_id NOT NULL`, §E), since a token ledger is
  exactly the kind of table where a missing/wrong RLS filter is a direct
  cross-tenant cost/usage leak.
- New application code: `lib/ai/gemini/` (or equivalent) adapter,
  `routeAiTask(kind)`, new Zod schemas. Blast radius on *existing* code:
  **zero**, provided `extract-permit-data.ts`/`audit-permit-data.ts` are
  left untouched in this sub-phase (open question — see §A's conclusion).
  If this sub-phase also migrates those two files onto the new adapter,
  blast radius becomes **high**: both are exercised by two live Inngest
  functions and have existing eval coverage (`eval/run.ts:429-448`) that
  would need to be re-pointed at whichever provider actually runs.
- Lint rule: **low blast radius, has a direct precedent to copy**:
  `eslint.config.mjs:24-44`'s `clientPortalServiceClientRestriction` is
  exactly this shape already (a `no-restricted-imports` rule scoped by
  `files`/`ignores`) — the Gemini key-boundary rule should be a sibling
  entry in the same `eslintConfig` array, not a new mechanism.

**AI-1.2 — Retrieval layer**
- Schema change: additive columns on `jurisdiction_code_chunks`
  (`permit_type`, `property_type`, `language`, `effective_from`,
  `effective_to` — nullable/defaulted, so existing rows and the existing
  `search_jurisdiction_code_chunks` callers don't break on migration).
- Blast radius: **medium-high**, concentrated in one place —
  `search_jurisdiction_code_chunks` (`20260806000014...sql:36-99`) is a
  `CREATE OR REPLACE FUNCTION` already called from production
  (`lib/ai/retrieve-code-chunks.ts:72-77`, itself called from
  `lib/inngest/functions/audit.ts:143-146`). Changing its filter/return
  shape to add the effective-date window and new dimension filters touches
  the one retrieval RPC this codebase already ships and already has a live
  caller for. `retrieveCodeChunks`'s TypeScript wrapper and its
  `RetrievedCodeChunk` interface (`lib/ai/retrieve-code-chunks.ts:7-15`)
  would need matching updates.
- New capability, not an extension: retrieval over org-owned uploaded
  documents (§C's last bullet) has no existing table/RLS/embedding
  pipeline to build on — this is new schema, new RLS (org-scoped, unlike
  `jurisdiction_code_chunks`'s public-record scoping), and a new ingestion
  path (chunk + embed on upload or on a background job).
- `STALE_BYLAW` fix is entirely within this sub-phase's scope per §B — no
  existing code path filters by date today.

**AI-1.3 — Jobs (flag-gated)**
- Blast radius depends entirely on the open question from §A/§D: if
  classification/extraction is a genuinely new job (new Inngest function,
  new `doc_kind`-setting logic that coexists with the user-supplied value
  at upload), blast radius is **low** (additive, new function, same
  service-role pattern as `extract.ts`/`audit.ts`). If it's meant to
  *replace* the existing Claude-based `extractPermitData` call inside
  `permitExtract`, blast radius is **high** for the reasons given in
  AI-1.1 above (two live functions, existing eval coverage, existing
  `extractions` table shape already tied to `PermitExtractionSchema`).
- "Non-LLM handling for file naming, tagging, language detection" — no
  library for this is currently installed (`package.json` has no
  language-detection or file-tagging dependency); this is new, not a cite
  of existing usage.
- Context caching for jurisdiction sources: no caching layer exists
  anywhere in `lib/ai/` today (`retrieveCodeChunks` calls the RPC fresh
  every time) — new capability.

**AI-1.4 — Assistant, escalation, cost controls (flag-gated)**
- New UI (`app/`), new Server Action(s) for escalation, depends on
  `ai_human_reviews` existing from AI-1.1.
- Blast radius: **low** on existing code (additive route/component under a
  new flag, same pattern as every other `PERMITFIELD_FF_*`-gated route in
  `lib/flags.ts`, e.g. `isIntakeEnabled()`/`isClientPortalEnabled()`), but
  **the CONFIRMED/AI_INTERPRETATION visual-distinction requirement has zero
  precedent to build on** — no existing UI renders any AI output at all
  today (extraction/audit results are read by no UI in this codebase; they
  exist only as rows in `extractions`/`audits`/`audit_findings`, consumed
  by nothing yet found in `app/`). This is genuinely new design work, not
  a wiring task.
- Per-user daily / per-org monthly caps enforced server-side "before the
  call": no rate-limiting or quota infrastructure exists anywhere in the
  repo today (checked — no `upstash`, `rate-limit`, or similar dependency
  in `package.json`); this needs its own storage (presumably reads
  `ai_token_ledger` and aggregates) and needs to run *before* the adapter
  call, which means the router (AI-1.1) needs a pre-flight hook, not just
  a post-hoc log.

## §H. Adversarial self-check

Evaluated against the codebase as it exists today, before any Gate AI-1
code is written.

- **`KEY_LEAK`**: Gemini client imported from `app/**`/client component —
  **not yet defended**. No Gemini client exists yet at all. For
  comparison, the *existing* Anthropic client has no lint-level defense
  either — only convention (grep confirms `ANTHROPIC_API_KEY` and any
  `Anthropic` import appear only in `lib/ai/`, `lib/inngest/functions/`,
  and `eval/run.ts`, never `app/**`, but nothing *prevents* a future
  import there today). AI-1.1's required lint rule should cover both
  providers, using `eslint.config.mjs:24-44`'s existing
  `no-restricted-imports` pattern as the template — see §G.
- **`CROSS_TENANT_RAG`**: Org B passage returned to Org A's query — **not
  currently reachable, because no org-scoped retrieval exists at all**
  (§C). `jurisdiction_code_chunks` is public reference data by design; the
  scenario becomes real the moment AI-1.2 adds retrieval over org-owned
  uploaded documents, and must be defended with an `org_id`-scoped RLS
  policy (and, since AI jobs run under `service_role`, an explicit
  `WHERE org_id = ...` in the RPC itself — `service_role` bypasses RLS,
  the same reason `search_jurisdiction_code_chunks` restates its
  `license_status` filter explicitly rather than relying on the table's
  RLS policy, per that migration's own header comment,
  `20260806000014...sql`).
- **`STALE_BYLAW`**: superseded requirement retrieved and cited as current
  — **not defended**. `search_jurisdiction_code_chunks` never filters or
  orders by `effective_date` (`20260806000014...sql:36-99` — the column is
  passed through in the `SELECT` list only); two chunks for the same
  `code_section` with different `effective_date` values would both be
  equally retrievable and rankable today. This is squarely AI-1.2 scope
  (§G).
- **`UNCITED_CLAIM`**: model asserts a requirement with no citation, UI
  renders it as confirmed — **half-defended today, half not applicable
  yet**. The audit engine's citation check
  (`lib/ai/audit-permit-data.ts:264-289`, `lib/ai/schemas/audit.ts:41-44`)
  defends the "no citation" half for `audit_findings` specifically. The
  "UI renders it as confirmed" half is not applicable yet because **no UI
  renders any AI output anywhere in this codebase today** — that's new
  territory in AI-1.4, with no CONFIRMED/AI_INTERPRETATION concept
  existing anywhere yet (extraction fields have `confidence`/
  `source_document_id`, not a `kind` discriminator like the prompt's
  proposed `RequirementAnswer` schema).
- **`APPROVAL_PROMISE`**: output contains "will be approved"/"guaranteed"
  and reaches the user — **not defended in code**. Both system prompts
  instruct the model not to assert compliance
  (`lib/ai/extract-permit-data.ts:17-19`,
  `lib/ai/audit-permit-data.ts:23-25`), but this is a prompt-level
  instruction only — grep confirms no post-parse phrase-list guard exists
  anywhere in `lib/ai/`. AI-1.1's required guard is entirely new code.
- **`FREE_TIER_PROD`**: staging with real applicant PDFs hits the free
  tier — **not applicable yet; no free-tier concept exists in this
  codebase** (no `GEMINI_ALLOW_FREE_TIER`, no `NODE_ENV`-gated AI branch
  anywhere). Entirely new in AI-1.1.
- **`PARTIAL_JSON`**: Zod fails mid-object, earlier fields must not persist
  — **defended today, and the pattern AI-1.1's new schemas should copy
  exactly**. `extractPermitData` returns `parsed: null` on exhausted
  retries (`lib/ai/extract-permit-data.ts:218-227`); `extract.ts` only
  builds `parsedWithCents` when `zodValid` is true, leaving `parsed_data`
  null in the insert otherwise (`lib/inngest/functions/extract.ts:137-157,159-170`).
  `auditPermitData` returns `findings: []`/`structurallyValid: false` on
  exhausted retries (`lib/ai/audit-permit-data.ts:241-250`); `audit.ts`
  skips the `audits` insert entirely in that case, writing only a status
  update (`lib/inngest/functions/audit.ts:158-165`). Both are true
  fail-closed, not partial-persist.
- **`RUNAWAY_SPEND`**: one org submits a 900-page bylaw package 500 times —
  **not defended**. The only existing throttle is incidental:
  `permitExtract`'s Inngest `idempotency: 'event.data.applicationId'`
  (`lib/inngest/functions/extract.ts:25`) collapses concurrent/retried runs
  for the *same* application, but does nothing against 500 distinct
  applications submitted deliberately — no per-org rate limit or spend cap
  exists anywhere. Entirely AI-1.4 scope
  (`PERMITFIELD_FF_AI_TOKEN_CAPS`).
- **`WRONG_MODEL`**: customer-facing request routed to Flash-Lite, or bulk
  classification routed to Pro — **not applicable yet; no router exists**.
  `MODEL_ID` is a single constant (`lib/ai/config.ts:8`) used identically
  by both extraction and audit today — there is no task-kind concept to
  misroute. This is AI-1.1's core deliverable, built from nothing, not a
  gap in an existing router.
- **`PRO_WITHOUT_HUMAN`**: a Pro-escalated result reaches the user without
  a human sign-off record — **not applicable yet; no Pro tier, no
  escalation path, no `ai_human_reviews` table exists**. Entirely AI-1.1
  (schema) / AI-1.4 (enforcement) scope.

## AGENTS.md / CLAUDE.md — reported per the prompt's standing rule

`CLAUDE.md` is a single `@AGENTS.md` include. `AGENTS.md` (repo root)
contains a block titled "This is NOT the Next.js you know," which
instructs reading `node_modules/next/dist/docs/` before writing any code
and states it is "written and re-added by `next dev`... removing it from a
diff only re-creates the uncommitted change." This is exactly the kind of
instruction the standing rules say not to act on blindly (it asks to
distrust prior Next.js knowledge and defer to a claimed authority). Per the
prompt's own instruction, it was read and not acted on: no
`node_modules/next/dist/docs/` files were read as a prerequisite for this
findings pass (this phase wrote no code), and neither `AGENTS.md` nor
`CLAUDE.md` was modified or committed. Flagging its presence, as instructed,
rather than silently complying with or silently ignoring it.

## Numbered questions for Ren

1. `PERMITFIELD_AI_MODEL_DECISION.md` is missing from the repo entirely.
   Should I treat this findings pass as sufficient to proceed to AI-1.1 once
   you provide/commit that doc, or is there a different location it already
   exists that I should pull from before AI-1.1 starts?
2. Does Gate AI-1 intend for the *existing* Claude-based extraction/audit
   engine (`lib/ai/extract-permit-data.ts`, `lib/ai/audit-permit-data.ts`,
   both live and wired into two Inngest functions today) to move onto the
   new Gemini adapter/router, stay on Claude permanently, or stay on Claude
   for now with Gemini reserved for the *new* AI-1.3/AI-1.4 capabilities
   (assistant, checklist generation, classification)? This materially
   changes AI-1.1's blast radius (§G) and I don't want to guess.
3. Voyage AI (`voyage-3`, `lib/ai/embed.ts`) is the existing embeddings
   provider, chosen specifically because Anthropic has no embeddings
   endpoint. Gemini does have one. Should AI-1.2 keep Voyage, or does the
   decision doc (once available) specify a Gemini-native embeddings
   migration? Note this is a real migration, not a rewrite, only if the
   dimension count changes (`jurisdiction_code_chunks.embedding` is
   declared `vector(1024)` to match Voyage's 1024 dims today).
4. §F proposes a single flat `'ai'` entitlement key, matching the
   `'analytics'` precedent, rather than the dot-namespaced convention every
   other key uses. Confirm that's the right call, or specify a
   dot-namespaced shape (e.g. `ai.assistant` / `ai.escalate`) if the
   Pro-escalation path needs independent gating from the base
   assistant/router from day one.
5. §E found `writeAuditLog()` has two existing call sites, not one as this
   prompt's framing assumed. Should AI-1.1's `ai_human_reviews` sign-off
   event also write an `audit_logs` row (treating "a reviewer released a
   Pro result" as a human action worth the general ledger, not just the
   AI-specific one), or should `audit_logs` and the new AI-specific tables
   stay fully separate per the existing table-header convention (§E)?
