# PermitField OS — Lifecycle & Compliance Expansion
## Claude Code Master Prompt (House Format)

**Repo:** PermitField OS
**Track:** Permit lifecycle foundation
**Execution model:** Phase-gated, approval-token, additive-only, flag-guarded
**Owner:** Ren / RENCO Technologies Inc.

---

## 0. OPERATING CONTRACT — READ FIRST, DO NOT SKIP

You are the principal full-stack architect on an existing PermitField OS codebase. You are expanding it. You are not rewriting it.

### 0.1 Non-negotiable execution rules

1. **Phase gates are hard stops.** You may not begin a phase until I reply with the exact token `APPROVED: PHASE <n>` on its own line. Any other reply — including "looks good", "yes", "go ahead" — is not approval. If you are unsure whether you have approval, you do not have approval.
2. **Phase 0 is read-only.** Zero writes. No files created except `PHASE_0_FINDINGS.md`. No migrations. No installs. No `npm install`, no `prisma migrate`, no `supabase db push`.
3. **Additive-only.** You may add tables, columns, files, routes and components. You may not drop, rename, or retype anything that exists. New columns on existing tables must be `NULL`-able or carry a default. No destructive migration is permitted in any phase of this work.
4. **Every new behavior ships behind a default-off feature flag.** With every flag off, the application must behave byte-for-byte as it does today. This is a testable claim and you will test it.
5. **One phase = one branch = one PR-sized diff.** Branch name `feat/permitfield-phase-<n>-<slug>`. Do not batch phases.
6. **No secrets.** Never read, print, echo, commit or modify `.env`, `.env.local`, or any credential file. If you need a new env var, add it to `.env.example` with a placeholder and document it. Never log tokens, signed URLs, session data, or file contents.
7. **No destructive shell.** No `rm -rf`, no `git reset --hard`, no `git push --force`, no database resets, no truncation, no seed-wipe.
8. **Stop and ask.** If a requirement in this document conflicts with what you actually find in the repository, stop and report the conflict. Do not resolve it silently in either direction. The repository is the source of truth about the repository; this document is the source of truth about intent.
9. **Never claim production-readiness.** Report what passes, what fails, and what is untested. If a test does not exist, say the test does not exist. Do not describe scaffolding as functional.

### 0.2 Product boundary

PermitField OS manages this workflow and nothing else:

`Project Intake → Jurisdiction Identification → Permit Requirement Determination → Document Collection → Application Readiness Review → Submission → Municipal Review → Corrections & Resubmission → Permit Issuance → Inspections → Final Approval → Closeout or Renewal`

**Out of scope — do not build, do not scaffold, do not "prepare for":** generic construction management, contractor CRM, accounting/invoicing, fleet management, workforce/time tracking, a replacement for municipal permitting systems, or anything that constitutes legal advice.

### 0.3 Compliance posture (this is the product's core liability surface)

- The system may **never** present unverified data as an official government requirement. This is enforced at the database level, not by convention (see §3.4).
- The system may **never** state or imply that a permit will be approved, or that a processing time is a commitment. Historical observation ≠ municipal commitment, and the UI must say so in copy, not just in a tooltip.
- **Generative AI is never the final authority on a requirement.** Deterministic rules + verified jurisdiction records control every official output. AI is permitted only for extraction/classification/summarization, its output is always `status = 'pending_human_review'`, and it can never write directly to a field that drives a requirement, a fee, or a readiness score.
- Every AI-produced object crossing into persistence passes a **Zod schema parse** first. Parse failure = reject and log, never coerce, never partial-write.
- Canada-first deployment. Assume PIPEDA applies. Confirm and document Supabase project data residency in Phase 0 findings. Flag it as a risk if the project region is outside Canada.

---

## 1. PHASE 0 — READ-ONLY REPOSITORY AUDIT (MANDATORY)

**Deliverable:** `PHASE_0_FINDINGS.md` at repo root. Nothing else.

Every factual claim in this document must carry a `path/to/file.ts:L120-L145` citation. A claim without a citation will be treated as a guess and rejected. If you cannot find something, write **NOT FOUND** — do not infer it from convention, and do not assume a feature exists because a similar product would have it.

### 1.1 Required sections of PHASE_0_FINDINGS.md

**A. Stack reality**
Framework and version, router (App vs Pages), TypeScript strictness, DB and access layer (Prisma? Supabase client? raw SQL? both?), auth provider and session mechanics, file storage, background jobs, subscription/billing provider, component library, test runner, CI config. Cite each.

**B. Existing domain model**
For each of: organization, membership/role, user, client, project, property, jurisdiction, permit, permit application, document, subscription — state whether it exists, where it is defined, its actual column list, and whether it is tenant-scoped. Produce a table.

**C. Multi-tenancy audit (highest priority)**
- What column carries tenant ownership, and on which tables? Which tables are missing it?
- Is RLS enabled? On which tables? Paste the actual policy definitions.
- Where does the code use the Supabase **service role key** or otherwise bypass RLS? List every call site. This is the primary escalation risk in the codebase.
- Is authorization enforced server-side, or is any of it only UI-conditional? List every place a check exists only in a component.
- Does any query filter tenant scope in application code rather than at the DB layer?

**D. Duplication and drift**
Existing features that are half-built, duplicated, or dead. Any second organization/user/billing concept. Any migration that has drifted from schema.

**E. Existing roles and permission model**
Actual enum values, actual checks, actual gaps.

**F. Security, privacy and data-integrity risks**
Ranked, with severity. Include: IDOR-prone routes, public storage buckets, unvalidated inputs, unscoped file paths, missing signed-URL expiry, error responses leaking internals, money stored as float/decimal-as-JS-number, missing FK constraints, missing unique constraints, destructive deletes.

**G. Money handling audit**
Every place currency is currently represented. State the type. Flag every float/`number` used for money.

**H. Subscription/entitlement reality**
Where plan limits are checked today. How many distinct places compare a plan/price. Whether any entitlement gate exists server-side.

**I. Conflict list**
Every place where this document assumes something the repo does not have (e.g. "use the existing organization system" — does one exist?). This section determines the real scope.

**J. Proposed implementation plan**
Re-scoped against reality, as sub-phases (§2), with a per-phase file list and migration list.

**K. Estimated blast radius**
Files touched per sub-phase, and which existing behavior each sub-phase could plausibly break.

### 1.2 Phase 0 adversarial self-check

Before submitting findings, answer these in writing. "No" answers require a fix or an explicit flag.

1. If I ran the Phase 1 migrations against the production database right now, name three ways data would be lost or corrupted.
2. Name every code path where a user of Org A could currently read a row belonging to Org B. If the answer is "none", show the enforcement mechanism for each table.
3. If the Supabase service role key leaked into a client bundle, what is the blast radius today?
4. Which of my findings are read from code, and which are inferred from naming? List the inferred ones separately.
5. Does the repo already contain a partial version of anything in Phase 1? If I build it fresh, what duplicates?

**STOP. Output `PHASE_0_FINDINGS.md` and wait for `APPROVED: PHASE 1.0`.**

---

## 2. RE-SCOPED PHASE PLAN

Your source brief packed sections A–J into a single "Phase 1". That is four to six phases of work, and building it as one unit produces a broad, shallow, half-wired codebase where nothing is verifiably correct. It is re-gated as follows. **Each sub-phase requires its own approval token.**

| Gate | Scope | Ships behind flag |
|---|---|---|
| **1.0** | Tenancy + RBAC + audit ledger foundation. Schema, RLS, permission matrix, append-only log. No UI. | `permitfield_lifecycle_core` |
| **1.1** | Project intake + properties + clients + configurable taxonomies | `permitfield_intake` |
| **1.2** | Jurisdiction directory + source verification model | `permitfield_jurisdictions` |
| **1.3** | Permit applications + status state machine + status history | `permitfield_applications` |
| **1.4** | Document management + revisions + secure access | `permitfield_documents` |
| **1.5** | Readiness checklist + deterministic scoring + gated override | `permitfield_readiness` |
| **1.6** | Deterministic requirements engine (rules only; no AI in the decision path) | `permitfield_requirements_engine` |
| **1.7** | Operations dashboard | `permitfield_dashboard` |
| **2.0** | **Client portal — moved out of Phase 1** | `permitfield_client_portal` |

**Why the client portal moved:** it is the single largest external attack surface in the product — untrusted users, file upload, cross-tenant read risk, and internal-note leakage. It must be built on top of a tenancy layer that is already proven by tests, not concurrently with one. Do not scaffold it during Phase 1. Do not add `client_visible` booleans "for later" — that flag is a security control and it gets designed in 2.0 with its enforcement.

Phases 3–7 (corrections/resubmissions, inspections/closeout, licence & expiration/renewal, permit intelligence, integrations) stay exactly as scoped in the original brief. **Do not implement, scaffold, stub, or add columns for them.**

---

## 3. PHASE 1 SPECIFICATIONS

Adapt every table and column name below to the conventions found in Phase 0. These names are intent, not literal DDL.

### 3.1 Gate 1.0 — Tenancy, RBAC, audit ledger

**Roles** (extend the existing enum; do not create a parallel one):
`platform_admin`, `org_owner`, `permit_manager`, `permit_coordinator`, `document_reviewer`, `applicant_contractor`, `client_user`, `auditor_readonly`

**Deliverable: an explicit permission matrix**, committed as `docs/PERMISSIONS.md` and implemented as a single server-side module (`lib/authz/*`). One table, rows = resource, columns = role, cells = `C/R/U/A/-` (create, read, update, archive, none). Prose permissions are not acceptable — every cell is explicit.

Enforcement requirements:
- Every check exists server-side. UI conditionals are a convenience layer only and are never the sole gate.
- RLS policies on every tenant-scoped table. Deny by default.
- `org_id` (or the repo's equivalent) is `NOT NULL` on every new tenant-scoped table with an FK.
- **Cross-organization FK prevention:** composite FKs or check constraints so a `permit_application` cannot reference a `project` from another org. Application-layer checking is insufficient.
- Any service-role/RLS-bypassing call added in this work must be justified in a code comment naming why it cannot be done under RLS. Prefer zero new ones.

**Audit ledger** — `audit_logs`, append-only, enforced in the database:
- `REVOKE UPDATE, DELETE` on the table from all application roles; add a trigger that raises on `UPDATE`/`DELETE`.
- Columns: `id`, `org_id`, `actor_user_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `before_summary` (jsonb, redacted), `after_summary` (jsonb, redacted), `ip`, `user_agent`, `occurred_at`.
- **Never** store secrets, signed URLs, full document contents, or raw PII blobs in audit rows. Store IDs and field names, not payloads.
- Audited actions: project creation, requirement changes, document upload/review, readiness override, application submission, every status change, municipal comment entry, correction, resubmission, permit issuance, permission change, archival.

**Archival, not deletion.** Every entity gets `archived_at` / `archived_by`. No hard deletes anywhere in this work. Default queries exclude archived rows.

**Money rule:** all currency stored as **integer minor units** (`bigint`, CAD cents) plus an explicit `currency` char(3). No floats, no JS `number` arithmetic on money, no `Decimal` round-tripping through JSON. Applies to `estimated_construction_value`, all fees, and all payments. Add a shared `Money` type and formatter; do not format currency ad hoc in components.

### 3.2 Gate 1.1 — Project intake

Fields per the original brief (org, client, project name, internal number, description, property address, municipality, province/territory, postal code, property type, work type, estimated construction value, property owner, applicant, contractor, designer/consultant, target construction date, target permit date, status, assigned coordinator, notes, attachments).

Additional requirements:
- **Property is its own entity**, not denormalized strings on the project. One property, many projects over time.
- Property type and work type are **configurable per organization** — a `taxonomies` table with org-scoped values, seeded with the brief's example list marked `is_seed = true`. Do not hard-code the list in TypeScript. Do not assume it is universal or complete.
- Canadian address model: province/territory enum, postal code validated against `A1A 1A1` format, but stored normalized. Do not assume US ZIP.
- Internal project number: unique **per organization**, not globally.
- Zod schema at the API boundary for every input. Server-side validation is authoritative; client-side is UX only.

### 3.3 Gate 1.2 — Jurisdiction directory

Fields per the brief. Plus:
- `jurisdiction_sources` is a **separate table** — one jurisdiction has many sources (fee schedule, processing times, forms page, bylaw), each with `url`, `source_type`, `retrieved_at`, `verified_at`, `verified_by`, `verification_status`, `notes`.
- `verification_status` enum: `unverified` | `pending_review` | `verified` | `stale` | `disputed`.
- **Staleness is automatic:** a `verified` source older than a configurable threshold (default 180 days) is computed as `stale` and must render with a visible warning. Do not require a human to notice.
- Every requirement surfaced to a user renders: source link, last verified date, verification status, and the responsible internal reviewer. Missing any of these = the requirement is not renderable.

### 3.4 Gate 1.6 — Requirements engine (deterministic only)

Inputs: project location, property type, work type, occupancy/use, scope attributes, construction value, org-configurable jurisdiction rules.

Outputs: potentially required permits, responsible jurisdiction, required documents, required forms, prerequisite approvals, verified fees only, verified processing estimates only, official source links, last verified date, warnings and unresolved questions.

Hard constraints:
- **Database-enforced:** a check constraint or trigger such that a `permit_requirement` row cannot be marked official/authoritative unless `verified_at IS NOT NULL AND verified_by IS NOT NULL AND source_id IS NOT NULL`. Never leave this to application code.
- Every engine output is `preliminary` until an authorized `permit_manager` reviews it. `preliminary` is a persisted column, not a UI label.
- Rules are data (`jurisdiction_permit_rules`), evaluated deterministically. Same inputs must always produce the same output — write a test that asserts this across 100 iterations.
- Unknown inputs produce an explicit `unresolved_question`, never a guess and never a default. "No rule found" is a valid, visible output.
- **Zero AI in the decision path in this phase.** If AI-assisted document extraction is added later, it writes to a staging table with `status = 'pending_human_review'` and Zod-validated shape, and never to the requirement itself.

### 3.5 Gate 1.3 — Permit applications & status machine

Fields per the brief. Plus:

**The 16 statuses require an explicit transition matrix** — the brief lists states with no edges, which guarantees invented transitions. Define `docs/STATUS_TRANSITIONS.md` and implement it as a single typed map:

`intake → requirements_review → collecting_documents → internal_review → ready_to_submit → submitted → under_municipal_review → {additional_info_required | corrections_required | approved | rejected}`, with `additional_info_required`/`corrections_required → resubmitted → under_municipal_review`, `approved → issued`, `issued → {expired | closed}`, and `withdrawn` reachable from any pre-approval state.

Rules:
- Every transition attempt goes through one server-side function. No component sets status directly.
- Invalid transitions throw a typed error and are **tested explicitly** — the negative tests matter more than the positive ones.
- Every transition writes `application_status_history`: previous status, new status, actor, actor role, timestamp, comment, optional attachment reference. This table is append-only under the same DB enforcement as `audit_logs`.
- Transitions are **idempotent by request key** — a double-click or retried request must not produce two history rows.
- One project has many applications; the constraint model must permit multiple applications of the same permit type on one project (revisions, phased work) — do not add a naive unique constraint on `(project_id, permit_type_id)`.

### 3.6 Gate 1.4 — Documents

- Private bucket only. **Tenant-scoped storage paths**: `org/{org_id}/project/{project_id}/application/{application_id}/{document_id}/{revision}`. Path must be derived server-side from the authenticated session, never from a client-supplied value.
- Signed URLs only, short TTL (≤15 min), generated per request, never cached in client state, never logged, never written to audit rows.
- Server-side validation of MIME type (by magic bytes, not extension), size cap, and filename sanitization. Reject on mismatch.
- **Revisions are immutable.** A re-upload creates `document_revisions.revision_number + 1` and retains all prior versions. No overwrite path exists in the code — not behind an admin flag, not for correcting a mistake.
- Per-document: category, status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, rejection_reason.
- Direct-object-reference test required: authenticated user from Org B requesting a valid Org A document ID must receive a 404 (not 403 — do not confirm existence).

### 3.7 Gate 1.5 — Readiness checker

- Checklist items per the brief, each with: required/optional, responsible party, due date, completion status, reviewer, review timestamp, rejection reason, related document, source requirement, last verified date.
- **The readiness score is computed from checklist rows only.** No heuristic, no AI, no cached denormalized number that can drift. If it can be computed, compute it; if it must be cached, cache it with the row versions it was computed from.
- `ready_to_submit` is blocked while any required item is incomplete.
- **Override:** requires `permit_manager` or above, a mandatory free-text reason (min length enforced), writes an `audit_logs` entry of type `readiness_override`, is surfaced permanently on the application record, and is gated by the `readiness_override` entitlement. An override is a visible, permanent fact about the application, not a silent unlock.

### 3.8 Gate 1.7 — Dashboard

Panels per the brief. Real queries only — no mock data, no placeholder counts, not even temporarily. Every panel implements four states: loading, empty, error, permission-denied. Every query is org-scoped at the DB layer. Aggregations must not N+1; state the query count per dashboard load in the phase report.

---

## 4. SUBSCRIPTIONS & ENTITLEMENTS

Use the **existing** subscription system found in Phase 0. Do not build a second one.

Entitlement keys: `maximum_active_projects`, `maximum_team_members`, `jurisdiction_requirements`, `readiness_checker`, `readiness_override`, `client_portal`, `correction_tracking`, `inspection_management`, `permit_expiration_tracking`, `analytics`, `api_access`.

Rules:
- **One module** (`lib/entitlements/index.ts`) exposes `can(org, key)` and `limit(org, key)`. No component, route, or query compares a plan name or price. Zero exceptions.
- Enforcement is server-side. A UI that hides a feature is not enforcement.
- Limit checks happen inside the same transaction as the action they gate, or the limit is racy.
- **Do not change any public subscription price** in this work. Do not add, rename, or reprice a plan.

---

## 5. TESTING REQUIREMENTS

Tests are a deliverable, not a follow-up. A gate is not complete without them.

**Mandatory (each gate ships the tests relevant to its scope):**
1. Tenant isolation — Org A user cannot read/write/list any Org B row, per table. Run against **two seeded organizations**, and assert at the DB layer with RLS active, not just through the API.
2. Role permission matrix — one test per non-trivial cell, including negative cases for every role.
3. Project creation, including limit enforcement at the entitlement boundary.
4. Multiple permit applications on one project.
5. Jurisdiction selection and source verification status transitions, including auto-stale computation.
6. Requirements generation determinism (same input → same output, repeated).
7. Requirement cannot be marked official without verification — assert the DB constraint rejects it.
8. Readiness score computed from actual checklist rows.
9. Readiness override: authorized succeeds with audit row; unauthorized fails; missing reason fails.
10. Document revision retains prior versions; no overwrite path reachable.
11. IDOR: cross-org document fetch returns 404.
12. Every valid status transition succeeds.
13. **Every invalid status transition fails** — enumerate the full invalid set, do not sample it.
14. Status transition idempotency under duplicate submission.
15. Audit log rows are created for each material action, and `UPDATE`/`DELETE` against `audit_logs` is rejected by the database.
16. Permit expiration calculation across timezone and DST boundaries.
17. Money: integer minor units round-trip with no precision loss; no float appears in any money path.
18. **Flags-off regression:** with every new flag off, the existing app's routes, queries and rendered output are unchanged.
19. Loading, empty, error and permission-denied states render for each new surface.

---

## 6. PER-GATE DELIVERY FORMAT

Every gate ends with a report in this exact shape. Do not deviate, do not summarize, do not omit a section because it is empty — write "none".

```
## GATE <n> REPORT

### 1. What was built
### 2. Files added (path list)
### 3. Files modified (path + what changed + why it was unavoidable)
### 4. Migrations added (name, forward summary, rollback SQL, verified reversible? yes/no)
### 5. Feature flags added (key, default, what it gates)
### 6. Security controls implemented (RLS policies, authz checks, validation — with file:line)
### 7. Tests added + actual output (paste the run, do not paraphrase)
### 8. Typecheck / lint / build results (paste the output)
### 9. What is NOT done, what is stubbed, what is untested
### 10. Known limitations and risks I am handing you
### 11. Adversarial self-check (below)
### 12. Manual QA checklist for a human
```

### 6.1 Adversarial self-check — required at every gate

Answer honestly. This section is the most valuable part of the report; a clean self-check with no findings is itself a finding.

1. **Cross-tenant leak:** a `permit_coordinator` in Org A guesses a valid Org B application UUID and hits every new endpoint. Walk each one. Where does it fail closed, and what is the exact enforcement line?
2. **Privilege escalation:** an `applicant_contractor` calls every new mutation directly with a forged payload. Which succeed? Which return an informative error that shouldn't?
3. **Unverified data leak:** describe the shortest path by which unverified jurisdiction data reaches a user's screen labelled as an official requirement. If there is no such path, show the constraint that closes it.
4. **Silent data loss:** name three ways this gate's migrations could lose or corrupt existing data on a populated production database. If none, prove it — cite the migration lines.
5. **Flag failure:** if a flag is off but a migration ran, is the app still correct? If a flag is toggled on mid-session for a live user, what breaks?
6. **Money corruption:** where could a currency value pass through a float, a `parseFloat`, a JSON round-trip, or a locale formatter and come back wrong?
7. **Audit gap:** which material action in this gate can complete without writing an audit row? Trace at least one path.
8. **Override abuse:** how does a coordinator get an application to `ready_to_submit` without an authorized override? Include indirect paths — direct status write, checklist item deleted, requirement marked optional, requirement archived.
9. **Race condition:** two coordinators act on the same application simultaneously. Two clients upload the same document. An entitlement limit is hit by two concurrent creates. What happens?
10. **The lie check:** which statement in my own report above is the one most likely to be wrong on closer inspection? Name it.

---

## 7. PHASE 1 ACCEPTANCE CRITERIA

Phase 1 (gates 1.0–1.7) is complete only when all of the following are demonstrated, not asserted:

1. All pre-existing PermitField OS functionality operates unchanged, verified with flags off.
2. An authorized user creates a permit project; unauthorized roles cannot.
3. A property and jurisdiction can be assigned to a project.
4. Multiple permit applications can belong to one project.
5. Verified jurisdiction rules generate preliminary requirements; unverified data cannot be surfaced as official — enforced by DB constraint.
6. Required documents can be requested, uploaded, reviewed, and rejected with a reason.
7. Application readiness is computed from actual checklist rows.
8. Incomplete applications cannot reach `ready_to_submit` without an authorized, reasoned, audited override.
9. Every status change is recorded in an append-only history with actor and timestamp.
10. Document revisions retain all previous versions; no overwrite path exists.
11. Material actions write audit entries; `audit_logs` rejects `UPDATE` and `DELETE` at the database.
12. Cross-tenant access is blocked and proven by tests against two seeded organizations with RLS active.
13. All money is stored and computed in integer minor units.
14. Mobile and desktop layouts work at 375px, 768px and 1440px.
15. Typecheck, lint, tests and production build pass — output pasted, not summarized.
16. Every migration has documented, tested rollback SQL.
17. Setup and testing documentation updated.
18. Client portal is **not** built, not stubbed, and not partially schema'd.

---

## 8. START HERE

Execute Phase 0 only. Produce `PHASE_0_FINDINGS.md` with file-and-line citations for every claim, including the §1.2 adversarial self-check, then stop and wait.

Do not begin any implementation. Do not create a branch for implementation work. Do not install dependencies.

Await `APPROVED: PHASE 1.0`.
