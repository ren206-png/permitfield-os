# PermitField OS

AI permitting and local compliance copilot for commercial and trade contractors. Canada launch
(Ontario, Alberta), field-trade-contractor-first (mechanical/electrical/plumbing shops pulling
permits from a truck, not developers' preconstruction teams).

**This product never asserts compliance.** There is no `isCompliant` anywhere in this system. It
produces a reviewable checklist of potential issues, each carrying a citation and a confidence, and
every AI-produced finding is `UNVERIFIED` until a human marks it reviewed. See "Non-negotiable
constraints" below before touching the AI layer.

## Status

Phase 5 (UI) complete — all five phases of the mission brief have now been built. Phases 1–4
(migrations + RLS + seed data, ingestion & extraction, audit engine, PDF filler) were live-verified
against a local Supabase instance (`supabase db reset` + the tenant isolation test, see below).
Phase 2 added: document upload (`app/api/documents/route.ts`), an Inngest background function that
routes each document to a text or vision extraction path and validates the model's response against a
Zod schema (`lib/inngest/functions/extract.ts`), and the storage buckets / `extracted` pipeline status
that support it. Phase 3 added: a hybrid (BM25 + vector, RRF-fused) retrieval RPC over
`jurisdiction_code_chunks` (`lib/ai/retrieve-code-chunks.ts`, `search_jurisdiction_code_chunks`), the
audit model call itself (`lib/ai/audit-permit-data.ts`) with per-finding citation and Zod validation that
fails closed to `ai_findings_rejected` rather than passing bad findings through, a deterministic (non-AI)
`missing_document` check (`computeMissingDocumentFindings` in `lib/inngest/functions/audit.ts`) driven by
`permit_types.compliance_rules` vs. actually-uploaded documents, and an offline eval harness
(`eval/run.ts`, `npm run eval`) exercising the citation/validation logic without requiring a live model
or database. Phase 4 added: `lib/inngest/functions/generate-pdf.ts` (`permit.generate_pdf`), which fills
each of an application's per-filing PDF templates from three trust-tiered data sources gated by a
confidence threshold, via either AcroForm field-name filling or coordinate-overlay text drawing, and
records the result in the append-only `generated_documents` table. See "PDF filler" below for the safety
mechanics. Phase 5 added the Next.js UI end to end — auth, org/contractor onboarding, the application
wizard, document upload, extraction/audit review, and generated-document download — see "UI (Phase 5)"
below.

## Coverage tiers — read this before adding a jurisdiction

"All of Canada" is a *market* claim, not a *corpus* claim. Every jurisdiction has a
`coverage_level`, surfaced in the UI on every screen:

- **`verified`** — hand-checked corpus, current forms, tested field maps. Full AI audit runs.
- **`assisted`** — official links, fee schedule, curated document checklist. AI audit is
  **disabled**, not degraded — the wizard and PDF pre-fill still work.
- **`listed`** — name and portal URL only. Waitlist capture. No AI output of any kind.

A `listed` or `assisted` jurisdiction must never render an empty findings list — a contractor reads
"no issues found" as "clean." It renders "not yet covered." Getting this wrong is the single most
likely way this product injures a customer.

## Corpus provenance

Ingested content is limited to municipal amendments, local ordinances, published permit checklists,
and jurisdiction-issued application instructions — all public record. **ICC/NEC/IBC/OBC/ABC model-code
body text is never ingested** — it's copyrighted and not redistributable. A chunk's `license_status`
must be `public_record` before it's visible to any authenticated query (`jurisdiction_code_chunks`
RLS enforces this independently of application-layer filtering — see migration `20260806000008`).

Seed jurisdictions and their real sources (full detail in `PHASE_0_FINDINGS.md`):

| Jurisdiction | Authority | Real source |
|---|---|---|
| Toronto, ON | City of Toronto — Building Division | [Municipal Code Ch. 363](https://www.toronto.ca/legdocs/municode/1184_363.pdf), [permit application form](https://www.toronto.ca/wp-content/uploads/2025/10/94e5-14-0094-Final-Application-for-a-Permit-to-Construct-or-Demolish.pdf) |
| Ontario (province-wide) | Electrical Safety Authority (ESA) | [Forms hub](https://esasafe.com/fees-and-forms/forms/), [notification requirement guidance](https://esasafe.com/notifications-and-inspections/do-i-need-to-file-a-notification/) |
| Calgary, AB | City of Calgary — Building Permit | [Commercial application](https://www.calgary.ca/content/dam/www/pda/pd/documents/carls/building-permit/commercial.pdf), [CARLs requirements](https://www.calgary.ca/development/permits/carl-application-requirements.html) — full text of Bylaw 64M94 has no stable static URL, sourced via [publicaccess.calgary.ca](https://publicaccess.calgary.ca) (open question, see Phase 0 findings) |

**Limits:** the MVP corpus covers 4 seed jurisdictions (2 `verified`, 1 `assisted`, 1 `listed`) across
2 provinces. Quebec is out of scope entirely (RBQ licensing + French-language obligations — not
seeded). No US jurisdiction, code family, or terminology exists in this codebase; four columns
(`jurisdictions.country`, `jurisdictions.unit_system`, `permit_applications.currency_code`,
`authorities.authority_level`) exist specifically to make a future US phase a migration rather than a
rewrite, without any US logic actually present yet.

## Multi-authority permitting

Canadian permitting is not municipal-only. A single job can require **multiple filings to different
authorities** — e.g. a Toronto electrical service upgrade needs a City of Toronto building permit
*only if* it triggers a structural/enclosure change, and an ESA notification *always*, filed
province-wide and independent of the city. `authorities` and `permit_type_filings` model this
directly; the wizard (Phase 5) outputs one application package per filing, not per permit type.

## Audit engine

The audit engine (`lib/inngest/functions/audit.ts`, triggered by `permit/application.extracted`) is
gated by **two independent checks**, both of which must pass before a model call ever happens:
`isAiAuditEnabled()` (`lib/flags.ts`, an ops-level kill switch, default OFF) and the jurisdiction's
`coverage_level === 'verified'` (a product-tier gate — see "Coverage tiers" above). When either gate is
closed, **no `audits` row is inserted at all** — not a row with zero findings. An empty findings list
and a missing audit are deliberately distinguishable in the data model, because a contractor reading an
empty list as "clean" when the real answer is "not yet covered" is the single most likely way this
product injures a customer.

**Citation discipline (SS0.2 — "no citation, no finding"):** every finding the model produces must cite
a `code_chunk_id` that was actually retrieved and shown to it in that call. `validateAuditFindingItem`
(`lib/ai/audit-permit-data.ts`) checks each finding's `code_chunk_id` against the set of chunk IDs
actually sent to the model — a citation to any other ID, fabricated or otherwise, is rejected. The one
exception is `missing_document`, which needs no citation because it isn't produced by the model at all.
The `code_chunk_id is not null or kind = 'missing_document'` rule is enforced in three independent
places: a Postgres `check` constraint on `audit_findings`, a Zod `.refine()` on `AuditFindingSchema`,
and this per-item validation function — the same invariant, defended at the DB layer, the schema layer,
and the application layer.

**`missing_document` is never AI-generated (SS4.3):** even a structurally well-formed
`missing_document` finding from the model is rejected outright by `validateAuditFindingItem`. That
finding kind is instead computed deterministically by `computeMissingDocumentFindings`, comparing
`permit_types.compliance_rules.requires_document_kinds` against the set of document kinds actually
uploaded for the application — no model call involved, no way for a hallucination to produce a false
"you're missing a document" or, worse, suppress a real one.

**Fail-closed at two granularities:** a structurally malformed whole response (fails
`AuditResponseSchema`) triggers a bounded retry (`AUDIT_MAX_VALIDATION_ATTEMPTS`), matching the
extraction pipeline's existing retry-once-then-fail-closed pattern. A single bad *finding* within an
otherwise-valid response (bad citation, forbidden kind, out-of-range confidence) does not invalidate the
whole batch — it's dropped into `ai_findings_rejected` (service-role-only, `raw_finding jsonb` +
`rejection_reason`) and every other finding in that response is still persisted. `ai_findings_rejected`
is the source of the SS6 citation-validity-rate metric — the fraction of raw model findings that made it
through validation, tracked as a hallucination-rate proxy over time.

**Retrieval degrades, never errors:** `search_jurisdiction_code_chunks` always runs BM25 lexical ranking
(`ts_rank` over the GIN-indexed `content_tsv`) and additionally runs vector similarity ranking only when
`isVectorRetrievalEnabled()` is on and a query embedding was computed; the two rankings are fused with
Reciprocal Rank Fusion (k=60), which combines rank *position* rather than raw incompatible-scale scores.
Against today's empty corpus this returns zero rows, not an error, and `auditPermitData` short-circuits
on zero retrieved chunks — returning a clean empty result without ever calling the model — rather than
sending a prompt with no citable material.

**Eval harness (SS6):** `npm run eval` runs `eval/run.ts` — offline checks (no API key or database
required) against fixtures in `eval/fixtures/audit-findings/` covering: a valid cited finding accepted,
an uncited citation rejected, a model-produced `missing_document` rejected, a null citation on a
non-`missing_document` kind rejected, and out-of-range confidence rejected; plus offline checks for
`computeMissingDocumentFindings` and the zero-retrieved-chunks short-circuit (using a `Proxy` that
throws if the Anthropic client is ever touched, to prove no model call happens). A separate live
extraction-accuracy section runs only when `ANTHROPIC_API_KEY` is set and prints `SKIPPED` otherwise —
it has not been exercised against a real model in this environment. `eval/run.ts` is a single harness
covering both Phase 3 and Phase 4 (see "PDF filler" below) — the pass count reported at the end of
`npm run eval` is a combined total, currently **46 passed, 0 failed** offline; live section unexercised.

## PDF filler

`lib/inngest/functions/generate-pdf.ts` (`permit.generate_pdf`) turns a reviewed or auto-eligible
application into filled, downloadable government PDFs. It subscribes to **two** events —
`permit/application.audited` (fired by `permitAudit` even when the audit itself was skipped, e.g. an
`assisted`-tier jurisdiction) and `permit/application.review_confirmed` (fired by the new
`POST /api/applications/[id]/confirm-review` route, gated on every `audit_findings` row for the
application's latest audit having left `unverified` review status) — but does **not** branch on which
event fired. Instead it re-derives eligibility from live DB state with one gate:
`coverageLevel !== 'listed' && ((status === 'extracted' && coverageLevel === 'assisted') || status ===
'reviewed')`. This is the same "never trust the event payload for a business decision" discipline the
audit engine already applies to `coverage_level` — an `assisted` application goes straight from
extraction to PDF fill (no AI audit, no human-review gate, per "Coverage tiers" above), while a
`verified` application can only reach `generate-pdf` after a human has confirmed every finding.

**Three trust-tiered data sources, one confidence gate:** `lib/pdf/resolve-fields.ts` resolves each PDF
field's value from, in trust order, (1) the `permit_applications`/`contractors` rows the org itself
entered, (2) AI-extracted data from `extractions.parsed_data` gated by `PDF_FILL_MIN_CONFIDENCE` (0.75)
— any extracted field below that confidence resolves to `null` (left blank) rather than silently filling
a form with a guess — and (3) nothing else; there is no third source. A blank required field is recorded,
not hidden: `generated_documents.incomplete_required_fields`/`incomplete_optional_fields` (jsonb arrays
of `maps_to` paths) let a caller cheaply check "is this PDF actually filing-ready" without re-deriving it.

**Two fill methods, chosen per filing, never mixed:** Toronto's building-permit form has real AcroForm
fields (`lib/pdf/fill-acroform.ts`, matched by `permit_form_fields.pdf_field_name`); ESA's ICIA form does
not — it's a flattened Excel export with zero AcroForm fields (see "Reference forms" below) — so it uses
coordinate-overlay text drawing instead (`lib/pdf/overlay-coordinates.ts`, driven by
`permit_form_fields.overlay_page/x/y`). A `check` constraint on `permit_form_fields` already enforces
exactly one of those two field-shapes per row; `generate-pdf.ts` additionally throws (not skips) if a
single filing's field rows somehow mix both, since that would be a data-integrity bug rather than an
expected state. A filing with no `form_template_path` or no `permit_form_fields` rows yet (true today for
ESA and Calgary — see "Reference forms") is skipped, not treated as an error; the run only counts as
`succeeded` if at least one filing actually produced a document, since zero documents from an application
with real filings due would misrepresent a failure as "documents_generated."

**Phase 4 adversarial self-check**, following the same "verify against live state, document what's
still wrong" discipline as the Phase 3 `service_role` grants note below:

- **Storage path bug caught before shipping, not after:** the first draft uploaded generated PDFs to a
  bare `${applicationId}/...` path. `permitfield-generated`'s RLS policy actually authorizes via
  `storage.foldername(name)[1]::uuid` matched against `is_org_member(...)` — i.e. it requires `org_id` as
  the *first* path segment, same as every other bucket. Caught by re-reading the bucket's own RLS policy
  against the path this function was about to construct, before running anything live. Fixed by routing
  through `buildStoragePath(orgId, applicationId, sha256, filename)` (`lib/storage/documents.ts`), the
  same helper `extract.ts` already uses for uploads — this required adding `org_id` to `generate-pdf.ts`'s
  `permit_applications` select.
- **`permit_type_filings.is_conditional_on` is defined and seeded, but never evaluated.** The column
  exists (`supabase/migrations/20260806000005_permit_types_and_filings.sql`), and `seed.sql` populates a real value on Toronto's
  Electrical Service Upgrade filing (`{"trigger": "structural_or_enclosure_change"}`, matching the
  "Multi-authority permitting" section above). No application code reads it — `grep -rn
  "is_conditional_on"` across every `.ts` file turns up only the migration and the seed insert.
  `generate-pdf.ts` selects **all** `permit_type_filings` rows for an application's `permit_type_id`
  unconditionally, so today it will generate a Toronto building-permit PDF for every Electrical Service
  Upgrade application, including ones that never trigger a structural/enclosure change. This gap predates
  Phase 4 — `audit.ts` doesn't evaluate the condition either — but Phase 4 is the first place it produces
  a visible, wrong artifact (an unnecessary filled PDF) rather than just an unused column. Not fixed here;
  evaluating `is_conditional_on` against application data needs a real conditions schema and is Phase 5+
  scope, flagged rather than silently shipped.
- **AcroForm filling is text-field-only.** `fillAcroForm` calls `form.getTextField(...)` exclusively;
  checkbox, dropdown, and radio-group AcroForm fields are unsupported and will throw if referenced by a
  `permit_form_fields` row. Not currently a live problem (Toronto's 71 real fields haven't been mapped
  into `permit_form_fields` yet at all — the seed only defines the synthetic-fixture path exercised in
  `eval/run.ts` — so this limitation hasn't been hit against a real form), but it will need addressing
  before Toronto's actual field map ships.
- **Overlay text uses one fixed font size for every field** (`OVERLAY_FONT_SIZE` in
  `lib/pdf/overlay-coordinates.ts`) — no per-field size, matching the fact that zero real overlay
  coordinates are seeded yet (see "Reference forms"), so this hasn't been validated against an actual
  form layout either.
- **Applicant name splitting is naive.** `splitApplicantName` (`lib/pdf/resolve-fields.ts`) splits on
  whitespace and treats everything after the first token as the last name — "Maria Elena Gonzalez" fills
  `firstName: "Maria"`, `lastName: "Elena Gonzalez"`. Covered by an eval case documenting the behavior,
  not fixing it; a correct implementation needs a real name-parsing approach, out of scope here.
- **The Storage upload/download HTTP path is unverified end-to-end in this environment.** This
  environment's `supabase_kong` and `supabase_rest` containers were already stopped before this phase
  started (unrelated to this phase's changes) and `supabase start` does not bring them back up, so the
  Supabase JS client — which talks through Kong → PostgREST — cannot be exercised here. Verified instead
  at the SQL layer: `service_role`'s grants on every table `generate-pdf.ts` touches were confirmed via
  `information_schema.role_table_grants`, and the actual read/write sequence was exercised as
  `SET ROLE service_role` inside a rollback-safe transaction against real seed data. The Storage bucket
  upload call itself (`supabase.storage.from(...).upload(...)`) remains unexercised end-to-end here — a
  real deployment target with working Kong/PostgREST should re-verify this before relying on it.

## UI (Phase 5)

The Next.js App Router UI on top of Phases 1–4's backend. Three route groups: unauthenticated (`/login`),
org-setup (`/onboarding`), and the authenticated app shell (`app/(app)/`) covering applications,
contractors, and the per-application detail/review workflow.

**Next.js 16's `middleware.ts` → `proxy.ts` rename.** This project's own `AGENTS.md` warns "this is NOT
the Next.js you know" — and it wasn't: `middleware.ts` is deprecated in this version in favor of
`proxy.ts` (`export function proxy(request)` instead of `export function middleware(request)`), confirmed
by reading `node_modules/next/dist/docs/.../proxy.md` before writing any routing code, not discovered via
a broken build. Root `proxy.ts` runs the standard `@supabase/ssr` session-refresh pattern (`getUser()`
forces a token refresh via the cookie adapter) and redirects unauthenticated requests to `/login`,
authenticated requests away from `/login` to `/applications`. Its matcher excludes `/api/**` — those
routes do their own `auth.getUser()` check and must return JSON on failure, not an HTML redirect.

**Three Supabase client contexts**, not two: `lib/supabase/client.ts` (new — browser-context
`createBrowserClient`, used only for `signInWithPassword`/`signUp` in the `/login` client component),
plus the pre-existing `lib/supabase/server.ts` (RLS-scoped, used everywhere else) and
`lib/supabase/service-client.ts` (RLS-bypassing, Inngest-only, untouched by this phase — no UI code
imports it).

**`requireOrgContext()`** (`lib/auth/org-context.ts`) is the one gate every `(app)` route passes through.
It re-queries `org_members` on every call rather than caching org identity anywhere client-reachable —
the same "re-derive from live DB state, never trust cached/client state for a security-relevant decision"
discipline `generate-pdf.ts` already applies to `coverage_level` (see "PDF filler" above). An owner
removed from an org mid-session loses access on their very next navigation, not whenever a stale cookie
happens to expire. The schema fully supports multi-org membership (`org_members` has no per-user
uniqueness constraint) but this phase's UI has no org switcher yet, so a member of more than one org is
deterministically pinned to their oldest membership — a UI scoping choice, not a data-model limitation.

**Server Actions for CRUD forms, Route Handlers for the audit/state-transition family.** Org creation,
contractor creation, and application creation (`app/onboarding/actions.ts`,
`app/(app)/contractors/new/actions.ts`, `app/(app)/applications/new/actions.ts`) use React 19
`useActionState` + `'use server'` Server Actions — the idiomatic modern App Router pattern for plain CRUD
forms. The two new endpoints most tightly coupled to the pre-existing audit workflow —
`POST /api/applications/[id]/findings/[findingId]/review` (confirm/dismiss one finding) and
`POST /api/applications/[id]/submit` (mark `documents_generated` → `submitted`) — are Route Handlers
instead, deliberately kept stylistically consistent with `confirm-review/route.ts` and
`documents/route.ts` rather than converted to Server Actions, since all four together form one family of
session-scoped, RLS-gated state-transition endpoints.

**Every trust-sensitive value is re-derived from the DB, never taken from client input**, matching this
codebase's standing rule (see `generate-pdf.ts`'s `coverage_level` re-check):
`applications/new/actions.ts` re-validates that a submitted `contractorId` actually belongs to the
caller's org and a submitted `permitTypeId` actually exists, rather than trusting the `<select>` options
the form happened to be populated with. The findings-review route re-derives the full
finding → audit → application chain and additionally rejects a finding that belongs to a *superseded*
audit run (`audits` is append-only, so a stale `findingId` from an old run must not still be reviewable
via a direct API call even though the UI itself never produces one).

**Coverage-tier-aware UI is load-bearing, not decorative.** `components/coverage-badge.tsx`'s wording
(`Verified coverage` / `Assisted — AI audit off` / `Listed only — not yet covered`) mirrors "Coverage
tiers" above verbatim and appears everywhere a jurisdiction is shown. The application-detail page's empty
audit-findings state goes one step further: on an `assisted`/`listed` jurisdiction, zero findings is
never rendered as "nothing wrong was found" — the copy explicitly says no automated review ran, because
an empty list reading as "clean" is this product's single most dangerous failure mode (see the
`coverage-badge.tsx` header comment and "Coverage tiers" below).

**Money stays integer-cents end to end.** The new-application wizard's estimated-job-value field goes
through `lib/money/cents.ts`'s float-free `parseCurrencyToCents` — an empty input means "not yet known"
(stored `null`), never coerced to `0`; an unparseable string is rejected with an error rather than
silently truncated.

**Phase 5 adversarial self-check:**

- **No generated Supabase TypeScript types exist in this project** (confirmed via `grep` for
  `createClient<Database>` / `database.types.ts` before writing anything — neither exists). Every new
  query is untyped, same as every pre-existing query in this codebase (e.g. `confirm-review/route.ts`'s
  bare `.select('id, status')`). This is a consistency choice, not an oversight, but it means a renamed
  column would surface as a runtime error, not a type error — `npx tsc --noEmit` passing clean on this
  phase's code does not catch schema drift the way generated types would.
- **No live end-to-end verification against a running Supabase instance was possible in this
  environment.** Same pre-existing limitation Phase 4 already hit and documented above: this
  environment's Docker/Podman toolchain isn't installed at all (`supabase status` fails with
  `docker: command not found`), so `supabase start` can't run. Verification here was `npx tsc --noEmit`
  (clean), `npm run lint` (clean, zero warnings), `npx next build` (clean production build, confirms
  `proxy.ts` is picked up as `Proxy (Middleware)` in the route summary — not silently ignored the way a
  stray `middleware.ts` would be), and an independent adversarial code-review pass cross-referencing every
  new query against the actual migration files for column names, FK join directions, and RLS policy text.
  That review found no blockers; one informational gap it surfaced (finding-review not scoped to the
  latest audit) was fixed immediately after (see above). A real deployment target with a working
  Supabase/Docker stack should still re-run the tenant-isolation test and a manual click-through before
  this is trusted in production — this phase's testing is "provably self-consistent," not "observed
  working against a live database."
- **The findings-review route does not gate on `permit_applications.status`.** `confirm-review/route.ts`
  and `submit/route.ts` both check the application is in the exact status they expect before acting; the
  new per-finding review route does not check that the application is in any particular status (e.g. it
  will accept a confirm/dismiss even if the application later moved past `ready_for_review`). This is
  intentional, not an oversight: unlike a full-review confirmation, reviewing one finding is not itself a
  workflow-advancing action, and a contractor going back to reclassify a finding as dismissed after the
  fact (e.g. new information from the authority) is a legitimate use case the schema already supports
  (`review_status` stays mutable specifically for this — see `audits_and_findings.sql`'s header comment).
  Flagged here as a deliberate scope decision rather than left undocumented.
- **No org switcher.** Documented above under `requireOrgContext()` — a user in more than one org is
  pinned to their oldest membership for the whole of this phase's UI. Not a data-model gap (schema
  already supports it), just out of scope for this pass.
- **Signed URLs for document downloads are generated fresh on every page load with a 5-minute TTL**
  (`app/(app)/applications/[id]/page.tsx`), server-side, using the caller's own RLS-scoped session — never
  `service-client.ts`. This was a deliberate choice over public URLs (both storage buckets are private,
  see "PDF filler" above) but means a page left open for more than 5 minutes has stale download links
  until refreshed; acceptable for this phase, not optimized further.

## Database / RLS

Every tenant table is scoped to `org_id` via `org_members`, enforced with two `SECURITY DEFINER`
helper functions (`is_org_member`, `is_org_owner`) to avoid self-referential RLS recursion — see
`supabase/migrations/20260806000002_organizations_and_members.sql`. Reference data (`jurisdictions`,
`authorities`, `permit_types`, `permit_type_filings`, `permit_form_fields`,
`jurisdiction_code_chunks`) is read-only for authenticated users; writes are service-role only.
`extractions`, `audits`, and `audit_findings` are append-only (enforced by triggers, not just
convention) — `audit_findings.review_status`/`reviewed_by`/`reviewed_at` are the sole exception,
mutable so a contractor can confirm/dismiss a finding without the underlying finding record changing.

**Tenant isolation test:** `supabase/tests/tenant_isolation.test.sql` — proves org A cannot read or
write org B's rows under RLS. Live-verified locally after the Phase 1 migrations, again after the
Phase 2 migrations (`20260806000012`, `20260806000013`), and again after the Phase 3 migrations
(`20260806000014` adding `search_jurisdiction_code_chunks`, `20260806000015` fixing a `service_role`
grants gap — see below) — each round confirming the new schema didn't regress isolation. Now asserts
8 checks, including a Phase-3-added pair covering `audits`/`audit_findings` specifically (previously
untested because no seed data populated those tables).

**A note on that `service_role` grants gap**, since it's the most consequential thing this phase's
adversarial self-check turned up: `20260806000011_grants.sql` originally claimed "service_role bypasses
RLS and GRANT checks entirely." That's false — `service_role` has Postgres's `BYPASSRLS` attribute,
which bypasses row-level security policies only; it is not a superuser and holds no table privileges of
its own. Verified live: before `20260806000015_service_role_grants.sql`, `service_role` had zero
SELECT/INSERT/UPDATE grants on any `public` schema table, meaning every Inngest background function —
`permitExtract` since Phase 2, not just this phase's `permitAudit` — would have failed with "permission
denied" on its very first query, in every environment this had ever run in. Caught here because this
phase's adversarial pass actually exercised `service_role` against a live database for the first time;
the tenant isolation test previously only exercised `authenticated`/`anon`, and the eval harness never
touches a live database. Fixed with explicit, scoped grants (not a blanket grant-all) and re-verified
end-to-end: every table/RPC each Inngest function actually touches was exercised as `service_role` in a
rollback-safe transaction after the fix, with zero permission errors.

Re-run the isolation test locally:

```bash
supabase start
supabase db reset   # applies all migrations + supabase/seed.sql
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/tenant_isolation.test.sql
```

Or run every `supabase/tests/*.test.sql` file (tenant isolation, audit log append-only/tenant
isolation/elevated-read, and lifecycle intake tenant isolation/composite-FK/atomicity) in one command
after `supabase start` + `supabase db reset`: `npm run test:sql` (`scripts/run-sql-tests.sh`).

**CI** (`.github/workflows/ci.yml`, added Phase 1.1 follow-up): runs on every push/PR. Two jobs —
`build-and-test` (lint + build + `npm test`, no infra needed) and `sql-tests` (boots a real local
Supabase/Postgres stack via the Supabase CLI and runs `npm run test:sql` against it). Closes the gap
`PHASE_0_FINDINGS.md`'s original audit flagged ("CI: NOT FOUND") and every subsequent phase report
repeated: lint/build/tests are no longer only manually-run commands someone has to remember.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase/Anthropic/Voyage/Inngest credentials
supabase start                # requires Docker
supabase db reset             # applies migrations/20260806*.sql + seed.sql
npm run dev
npm run eval                  # offline extraction/audit/PDF-fill checks (see "Audit engine", "PDF filler")
```

## Reference forms

`docs-reference-forms/` contains the 3 real government permit PDFs downloaded (with explicit
permission) during Phase 0 to run an actual `pdf-lib` AcroForm field inspection rather than guess.
Findings: Toronto's form has 71 real AcroForm fields, Calgary's commercial form has 15, and ESA's ICIA
Low Voltage notification form has **zero** — it's a flattened Excel export, so Phase 4's PDF filler
needs the coordinate-overlay path (`permit_form_fields.overlay_page/x/y`) from day one, not just
AcroForm mapping. See `PHASE_0_FINDINGS.md` §4 for the full inspection output.
