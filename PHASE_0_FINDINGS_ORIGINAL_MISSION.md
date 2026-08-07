# Phase 0 Findings — PermitField OS

Read-only analysis. No application code has been written. Two PDFs were downloaded (with explicit user
permission) purely to run a field-inspection script for requirement #4; that script and its output are
below and can be deleted before Phase 1 if desired.

---

## 1. Repository / workspace state

- `/Users/rennerkargbo/Desktop` is **not a git repository** and hosts many unrelated projects
  (`harborhub`, `omnipulse`, `pipefield-os`, `skulfees`, `tradeflow - os`, `tradepal-africa`, `kambuy-backend`,
  a stray `node_modules`, personal files, etc.).
- **`pipefield-os`** already exists on Desktop and is a real, actively-developed, unrelated product —
  "PipeField OS," a trade-contractor field-service/billing SaaS (Stripe billing tiers, push notifications,
  mobile nav, dark mode — see its own `PHASE_1_PLAN.md`, `AUDIT_REPORT.md`, `FEATURE_FLAGS.md`). It has
  **no permitting, code-compliance, or jurisdiction functionality**. Given the name collision with
  "PermitField OS," I am treating this as a hard boundary: **nothing in `pipefield-os` will be read, moved,
  or modified.** I flagged one thing found incidentally: its `.git/config` remote URL embeds a live GitHub
  Personal Access Token in plaintext (`https://ghp_...@github.com/ren206-png/PipeField-OS.git`). That's
  unrelated to this build but worth rotating/removing separately — your call, not touched here.
- A stray, unrelated `PHASE_0_FINDINGS.md` exists directly on Desktop (root) — leftover from a prior
  **KamBuy Backend** project, not PermitField OS. Not touched.
- **Decision: greenfield build at `/Users/rennerkargbo/Desktop/permitfield-os`**, its own directory and
  (in Phase 1) its own git repository, per the `permitfield-os` slug specified in §0.9. Nothing outside
  that directory is touched.
- Local toolchain: Node v24.16.0, npm 11.13.0, git 2.50.1. **Docker and `psql` are not installed/available**
  in this environment. Implication: I can write Supabase migrations, RLS policies, and Zod schemas, and run
  `tsc`/lint/unit tests that don't need a live Postgres. Anything requiring a live Supabase project (running
  migrations, RLS tenant-isolation tests, `pgvector` index creation) needs either a Supabase cloud project
  or local Supabase CLI + Docker, which the user would need to provide/authorize — I will not claim a
  migration "passed" unless it was actually run against a real database.

## 2. Files to be created (Phase 1 scope; later phases proposed for context only)

No existing files are modified — everything below is new, under `permitfield-os/`.

**Phase 1 (migrations + RLS + seed):**
| File | Purpose |
|---|---|
| `supabase/migrations/0001_orgs_and_members.sql` | `organizations`, `org_members` + RLS |
| `supabase/migrations/0002_contractors.sql` | `contractors` + RLS |
| `supabase/migrations/0003_jurisdictions_and_authorities.sql` | `jurisdictions`, `authorities` + read-only RLS |
| `supabase/migrations/0004_permit_types_and_filings.sql` | `permit_types`, `permit_type_filings`, `permit_form_fields` + RLS |
| `supabase/migrations/0005_applications.sql` | `permit_applications`, `application_documents` + RLS |
| `supabase/migrations/0006_extractions_and_audits.sql` | `extractions`, `audits`, `audit_findings`, `ai_findings_rejected` + RLS (append-only enforced via triggers, no `UPDATE`/`DELETE` grants) |
| `supabase/migrations/0007_code_chunks.sql` | `jurisdiction_code_chunks` with `vector(N)` + `tsvector` + ivfflat/HNSW + GIN indexes |
| `supabase/seed.sql` | 3 seed jurisdictions, 3 authorities, sample `verified`/`assisted`/`listed` rows |
| `supabase/tests/tenant_isolation.test.sql` (or a `.ts` test hitting a real project) | Proves org A cannot read org B's rows |
| `lib/brand.ts` | `PRODUCT_NAME`, `PRODUCT_SHORT`, `LEGAL_DISCLAIMER` constants (§0.9) |
| `.env.example` | Every env var, prefixed `PERMITFIELD_` |
| `README.md` | Corpus provenance section, coverage-tier explanation, limits |

**Later phases (not built now, listed so the shape of the repo is visible):**
`lib/ai/config.ts` (model ID constant), `lib/ai/permit-agent.ts` (prompt + schema), `lib/ai/extraction-agent.ts`,
Inngest functions `permit.extract` / `permit.audit` / `permit.generate_pdf`, `lib/pdf/fill-acroform.ts`,
`lib/pdf/overlay-coordinates.ts`, eval fixtures under `eval/fixtures/`, `eval/run.ts`, App Router pages under
`app/dashboard/permits/`.

## 3. Corpus provenance — three seed jurisdictions, real URLs

Per §0.6, Canadian permitting is authority-based, not city-based, so the three seeds below are **two
municipal building authorities across two provinces plus one province-wide agency authority** — deliberately
chosen to exercise the multi-authority model on day one.

### 3a. City of Toronto, Ontario — municipal building authority
- Municipal Code Chapter 363, "Building Construction and Demolition" (the actual by-law text — permits,
  fees, demolition control, right of entry): https://www.toronto.ca/legdocs/municode/1184_363.pdf
- Recent amending by-law (2022, preliminary review streamlining):
  https://www.toronto.ca/legdocs/bylaws/2022/law0049.pdf
- Toronto Building Forms Index (all application forms, checklists):
  https://www.toronto.ca/services-payments/building-construction/building-permit/forms-documents-additional-resources/toronto-building-forms-index/
- Application for a Permit to Construct or Demolish (the primary form, required in its current version as
  of Feb 16, 2026 — older versions rejected at intake):
  https://www.toronto.ca/wp-content/uploads/2025/10/94e5-14-0094-Final-Application-for-a-Permit-to-Construct-or-Demolish.pdf
- **License status:** by-law text and municipal forms are public record, published directly by the City.
  Clean for `license_status = 'public_record'`. This is municipal-amendment text, not OBC/NBC body text — no
  ICC/model-code copyright issue.

### 3b. Electrical Safety Authority (ESA) — Ontario, province-wide, `authority_level = 'agency'`, `jurisdiction_id = NULL`
- Forms hub: https://esasafe.com/fees-and-forms/forms/
- Notification requirement guidance ("do I need to file a notification"):
  https://esasafe.com/notifications-and-inspections/do-i-need-to-file-a-notification/
- Industrial/Commercial/Agricultural — Low Voltage notification form:
  https://esasafe.com/assets/files/esasafe/pdf/Forms/ICIA_1015LV-A.pdf
- Residential New / Renovation, Apartments forms also public at the same `/assets/files/esasafe/pdf/Forms/`
  path. This directly exercises §0.6's point that Ontario electrical is filed to ESA separately from, and
  in addition to, any municipal building permit.
- **License status:** ESA is a delegated administrative authority (not a private standards body); its
  notification forms and public guidance pages are public record for the purpose of this corpus. I did
  **not** attempt to ingest the Ontario Electrical Safety Code body text itself — that is model-code
  content and out per §0.4.

### 3c. City of Calgary, Alberta — accredited municipality, `authority_level = 'municipal'`
- Building Permit Bylaw 64M94 governs the permit process; I confirmed it is real and actively referenced
  (e.g., commercial application form cites "Calgary Building Permit Bylaw 64M94 (Section 5)") but its
  **full consolidated text is not at a stable static URL** — it lives behind the city's bylaw search portal:
  https://publicaccess.calgary.ca (linked from https://www.calgary.ca/bylaws/city-bylaw-library.html). I
  am flagging this honestly rather than guessing a direct PDF link; Phase 2 ingestion for Calgary will need
  either a portal-scripted fetch or a manual retrieval, confirmed with the user before building a scraper
  against a portal that may be JS-rendered (an `escribemeetings.com` council-document mirror I tried
  returned HTTP 403).
- What I **did** confirm as directly fetchable public record:
  - Land Use Bylaw 1P2007 (zoning): https://www.calgary.ca/planning/land-use/online-land-use-bylaw.html
  - Commercial Building Project Application (checklist + form): https://www.calgary.ca/content/dam/www/pda/pd/documents/carls/building-permit/commercial.pdf
  - Construction Site practical guide (roles/responsibilities): https://www.calgary.ca/content/dam/www/pda/pd/documents/inspections/practical-guide-for-construction-sites.pdf
  - CARLs (Building/Development forms + requirement lists): https://www.calgary.ca/development/permits/carl-application-requirements.html
- **Open question for you:** should Calgary's Phase 2 corpus start from these confirmed documents (checklist
  + construction-site guide + Land Use Bylaw excerpts) while 64M94's full text is sourced manually, or should
  Calgary be dropped from the 3 MVP seeds in favor of a jurisdiction with a cleaner static-URL bylaw? I'd
  lean toward keeping Calgary — it's the concrete example the spec itself gives for "accredited municipality"
  — but wanted to flag rather than silently proceed.

## 4. AcroForm inspection — actual results, not inference

You approved downloading the 3 forms above (Toronto, ESA, Calgary) to
`permitfield-os/tmp-phase0-pdf-inspection/`. I ran a `pdf-lib`-based Node script
(`inspect.mjs` in that folder) that loads each PDF and lists real `AcroForm` field names — not a
text-summarizer guess. Output:

| File | Pages | AcroForm fields | Verdict |
|---|---|---|---|
| Toronto — Application for a Permit to Construct or Demolish | 2 | **71** (e.g. `Applicant Last name`, `Project value estimated (in dollars)`, `Description of proposed work`) | **Real AcroForm.** `pdf-lib` field-name mapping (§3.7 `permit_form_fields.pdf_field_name`) works directly. |
| ESA — ICIA Low Voltage notification (1015LV-A) | 1 | **0** | **Flat form.** No `/AcroForm`/`/Fields`. Confirmed as a flattened Excel export. Needs the coordinate-overlay path — `overlay_page`/`overlay_x`/`overlay_y` — not AcroForm mapping. |
| Calgary — Commercial Building Project Application | 6 | **15** (e.g. `Applicants name`, `Business or contractor trade name`, `City of Calgary business ID`) | **Real AcroForm.** Mappable directly. Note: several of the 15 fields (`Natural Resources Canada Registration number`, `Energy Advisor name`) suggest this specific PDF is a multi-purpose package that includes an energy-code-compliance page bundled with the general application — worth a manual page-by-page look in Phase 4 before building the field map. |

**Implication for §2 tech-stack decision:** Phase 4 needs **both** code paths from day one, not just
AcroForm — at least one of the three seed jurisdictions (ESA, arguably the highest-stakes one since it's
filed on nearly every electrical job) is a flat form. This confirms the spec's own contingency ("if flat
scans, pdf-lib field mapping will not work and Phase 4 needs the coordinate-overlay path") is not
hypothetical — it's needed for the very first seed set.

## 5. Embeddings provider decision (required — Anthropic serves no embeddings endpoint)

**Proposed: Voyage AI**, model `voyage-3` (or `voyage-3-lite` if cost-sensitive), **1024 dimensions**.
Reasoning: Voyage is Anthropic's recommended embeddings partner, has a generous free tier suitable for MVP
corpus sizes (a few thousand chunks across 8–12 verified jurisdictions), and its retrieval-oriented model
family is a reasonable fit for short code/ordinance excerpts. `jurisdiction_code_chunks.embedding` will be
declared `vector(1024)` in the Phase 1 migration to match — **flagging this as an assumption to confirm**,
not a unilateral final call, since you may already have a preferred provider (e.g. if Supabase's own
embedding tooling or another vendor is preferred for billing-consolidation reasons).

## 6. Multi-authority data model — confirmed necessary, not speculative

The research above is direct evidence, not just spec-following: a single "service upgrade" job for a
Toronto contractor genuinely requires **two separate filings to two separate bodies** — a City of Toronto
building permit (if the panel work triggers structural/enclosure changes) and, separately, an ESA
notification of work for the electrical portion, filed province-wide and independent of the city. The
`authorities` / `permit_type_filings` split in §3.4a/3.4b is therefore load-bearing for the very first
seed jurisdiction, not a Phase-2-someday concern.

## 7. Open questions / assumptions (numbered)

1. **Embeddings provider** — proposing Voyage AI `voyage-3` / 1024 dims (§5 above); confirm or override.
2. **Calgary Bylaw 64M94 full text** — no stable static URL found; confirm whether to (a) proceed with the
   confirmed Calgary documents only for MVP corpus, (b) manually retrieve 64M94 text for one-time ingestion,
   or (c) swap Calgary for a different Alberta seed jurisdiction with cleaner static sourcing.
2b. Related: should the second MVP province's *third seed* instead be a smaller Alberta municipality with a
   simpler public bylaw library (to avoid the portal problem entirely), keeping Calgary for later in the
   `verified` tier ramp rather than in the initial 3 seeds?
3. **Supabase project** — no live Supabase project/connection exists yet. Phase 1 migrations will be written
   and validated with `supabase db lint`/local CLI if available, but actually applying them and running the
   tenant-isolation RLS test needs either a Supabase project you provide credentials for, or the Supabase
   CLI + Docker installed locally (currently not installed — see §1).
4. **Storage buckets** — `permitfield-uploads` / `permitfield-generated` (§0.9) will be created as private
   buckets with signed URLs in Phase 1's Supabase config, but actual bucket creation requires the live
   Supabase project from item 3.
5. **`tmp-phase0-pdf-inspection/`** — contains the 3 downloaded government PDFs plus `inspect.mjs` and its
   `node_modules` (installed one level up, in `/Users/rennerkargbo/Desktop/node_modules/pdf-lib`, since no
   `package.json` existed yet in `permitfield-os/`). I'd suggest either keeping these 3 PDFs as fixtures for
   the Phase 4 field-mapping work (rename the folder to something like `docs/reference-forms/`) or deleting
   them now that the inspection is recorded above — your call before Phase 1.
6. **Inngest** — will need an Inngest account/API key for Phase 2+ background jobs; not required for Phase 1
   migrations, flagging now so it's not a surprise later.
7. **`pipefield-os`'s exposed GitHub PAT** — noted in §1, entirely out of scope for this build, surfacing it
   once here per the safety guidance to flag security issues found incidentally; no action taken.

---

No code has been written. Waiting for `APPROVED: PHASE 0` (or corrections) before touching `PHASE 1`.
