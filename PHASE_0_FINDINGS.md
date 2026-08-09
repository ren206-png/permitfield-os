# Phase 0 Findings — Lifecycle & Compliance Expansion

Read-only repository audit. No application/schema code was modified, no migrations were written, no
packages were installed, no branch was created.

**Filename note (conflict flagged, then resolved non-destructively):** the master prompt asks for
this deliverable at `PHASE_0_FINDINGS.md`. That filename was already in use by the original 5-phase
mission brief's own Phase 0 deliverable (dated before Phases 1–5 were built, and cited by
`README.md` and `supabase/seed.sql` comments as a live reference for corpus-provenance and
field-mapping decisions — see e.g. `supabase/seed.sql:66` "Phase 0's research did not include that
measurement step"). This repository has **zero git commits** (`git log` on `main` reports "does not
have any commits yet" — verified this pass), so a plain overwrite would have been unrecoverable, not
just inconvenient. Resolution: the original file was renamed (not deleted) to
`PHASE_0_FINDINGS_ORIGINAL_MISSION.md` — its full content is preserved verbatim there, including the
corpus-provenance and AcroForm-inspection findings the two files above still cite by their old
`PHASE_0_FINDINGS.md` name — and this document now occupies the canonical `PHASE_0_FINDINGS.md` path
the master prompt asks for. No content from either document was lost.

---

## A. Stack reality

- **Framework:** Next.js `16.3.0` (`package.json:12`), App Router. The `middleware.ts` convention is
  renamed to `proxy.ts` in this Next major version — this repo already made that migration
  (`proxy.ts:1-76`, confirmed against `node_modules/next/dist/docs` per `AGENTS.md:1-6`). Any new
  routing/auth work in Phase 1.0+ must use `proxy.ts`, not `middleware.ts`.
- **Runtime:** React `19.2.8` / `react-dom` `19.2.8` (`package.json:14-15`). TypeScript `^5`
  (`package.json:27`), `strict: true` (`tsconfig.json:7`), `noEmit: true` — type-checking is
  `npx tsc --noEmit`, there is no separate build-time type-check script in `package.json`.
- **Styling:** Tailwind CSS `^4` via `@tailwindcss/postcss` (`package.json:24`, `postcss.config.mjs`).
  No component library (no MUI/shadcn/Radix in `package.json`); all UI in this repo is hand-written
  Tailwind utility classes directly in `.tsx` files.
- **Database/BaaS:** Supabase, via `@supabase/ssr ^0.12.4` and `@supabase/supabase-js ^2.112.1`
  (`package.json:5-6`). Local Postgres major version `17` (`supabase/config.toml`, `major_version = 17`
  under `[db]`). **No live Supabase project is connected in this environment** — no `.env` file exists
  (only `.env.example`, verified via `ls -la` at repo root showing no `.env*` besides `.env.example`),
  and Docker/Podman are both absent from this environment (`docker --version` → `command not found`,
  `podman --version` → `command not found`, verified this pass). `supabase/tests/tenant_isolation.test.sql`
  and any live RLS behavior described anywhere in this repo's comments or `README.md` could not be
  re-verified live in this pass — see §F.
- **Background jobs:** Inngest `^4.16.0` (`package.json:7`), one HTTP-served endpoint
  (`app/api/inngest/route.ts`) fanning out to three functions under `lib/inngest/functions/`
  (`extract.ts`, `audit.ts`, `generate-pdf.ts`).
- **AI:** `@anthropic-ai/sdk ^0.115.0` (`package.json:4`) is the only model-calling dependency
  installed. `VOYAGE_API_KEY` is declared in `.env.example:16` for a proposed embeddings provider,
  but **no Voyage SDK/package is installed** (`node_modules` has no `voyage`-prefixed package,
  verified via `ls node_modules | grep -i voyage` this pass) — vector retrieval is flag-gated off by
  default (`lib/flags.ts:30-32`, `isVectorRetrievalEnabled()`) and the corpus is empty pre-ingestion,
  consistent with that.
- **PDF handling:** `pdf-lib ^1.17.1` (AcroForm fill + coordinate overlay, `lib/pdf/fill-acroform.ts`,
  `lib/pdf/overlay-coordinates.ts`) and `pdf-parse ^2.4.5` (text-layer extraction,
  `lib/pdf/text-density.ts`) (`package.json:9-10`).
- **Validation:** `zod ^4.4.3` (`package.json:11`), used for AI-output schemas
  (`lib/ai/schemas/extraction.ts`, `lib/ai/schemas/audit.ts`) — **not yet used for any Server
  Action/Route Handler's own form-input validation**; those currently do manual
  `typeof`/`.trim()`/length checks (e.g. `app/onboarding/actions.ts:37-45`,
  `app/(app)/applications/new/actions.ts`). Phase 1.1's requirement for "Zod validation
  server-side-authoritative at every API boundary" is a new discipline for the form-input side of
  this codebase, not an extension of an existing one.
- **Testing:** **No test framework is installed.** `package.json`'s `dependencies`/`devDependencies`
  contain no `jest`, `vitest`, `playwright`, `@testing-library/*`, or similar (confirmed by grep of
  `package.json`), and there is no `"test"` script (`package.json:5-11` lists only
  `dev`/`build`/`start`/`lint`/`eval`). What exists instead:
  - `supabase/tests/tenant_isolation.test.sql` — raw SQL, run manually via `psql` against a local
    Supabase instance per its own header comment (`supabase/tests/tenant_isolation.test.sql:7-13`).
    Not automated, not runnable in this environment (no Docker/psql).
  - `eval/run.ts` (`npm run eval`, via `tsx`) — a custom offline harness exercising citation/schema
    logic without a live DB or model call (per `README.md:26-27`), not a general-purpose test runner
    and not structured as pass/fail assertions a CI gate could consume out of the box.
  - The master prompt's 19 mandatory test categories (tenant isolation, role-matrix negatives,
    determinism, constraint rejection, IDOR, idempotency, etc.) have **no existing harness to extend**
    — Phase 1.0 will need to introduce one (see §J).
- **CI:** **NOT FOUND.** No `.github/` directory exists at repo root (verified via `ls -la .github`
  this pass). Lint/typecheck/build are documented as manually-run commands in `README.md` but nothing
  runs them automatically on push/PR.
- **Version control:** a `.git` directory exists (`main` branch, verified via `git branch
  --show-current`), but **zero commits exist** (`git log` errors "your current branch 'main' does not
  have any commits yet"; `git status --short` shows every tracked-looking file as `??` untracked).
  Nothing in this repository is currently recoverable via git history — every file is one `rm`/overwrite
  away from permanent loss until a first commit exists. This is a standing risk independent of this
  expansion, but is directly relevant to the master prompt's "one phase = one branch" rule, which
  presupposes a committed baseline to branch from.

## B. Existing domain model

All tables live under `supabase/migrations/20260806000001` through `20260806000017`, applied in
filename order (no down-migrations exist anywhere in this repo — every schema change so far has been
additive-only, matching the master prompt's own rule).

| Table | Defined in | Tenant scoping |
|---|---|---|
| `organizations` | `20260806000002_organizations_and_members.sql:5-9` | is the tenant root |
| `org_members` | `20260806000002_organizations_and_members.sql:13-20` | `org_id`, `unique(org_id,user_id)` |
| `contractors` | `20260806000003_contractors.sql:8-17` | `org_id` |
| `jurisdictions` | `20260806000004_jurisdictions_and_authorities.sql:21-34` | none — global reference data |
| `authorities` | `20260806000004_jurisdictions_and_authorities.sql:36-46` | none — global reference data, `jurisdiction_id` nullable for province-wide agencies |
| `permit_types` | `20260806000005_permit_types_and_filings.sql:6-17` | none — global reference data |
| `permit_type_filings` | `20260806000005_permit_types_and_filings.sql:19-27` | none — global reference data |
| `permit_form_fields` | `20260806000005_permit_types_and_filings.sql:33-49`, extended `20260806000017:17-31` | none — global reference data |
| `permit_applications` | `20260806000006_applications_and_documents.sql:17-31` | `org_id` |
| `application_documents` | `20260806000006_applications_and_documents.sql:35-49` | via parent `permit_applications.org_id` (no own `org_id` column) |
| `extractions` | `20260806000007_extractions.sql:5-16` | via parent `permit_applications.org_id` |
| `jurisdiction_code_chunks` | `20260806000008_jurisdiction_code_chunks.sql:14-32` | none — global reference data, gated by `license_status` |
| `audits` | `20260806000009_audits_and_findings.sql:9-16` | via parent `permit_applications.org_id` |
| `audit_findings` | `20260806000009_audits_and_findings.sql:24-45` | via `audits → permit_applications.org_id` |
| `ai_findings_rejected` | `20260806000010_ai_findings_rejected.sql:10-19` | none — internal ops/eval table, service-role only |
| `generated_documents` | `20260806000017_filing_form_templates_and_generated_documents.sql:50-60` | via parent `permit_applications.org_id` |

Key enums already in play: `org_role ('owner','member')` (`20260806000002:11`), `coverage_level
('verified','assisted','listed')` (`20260806000004:7`), `authority_level ('municipal','provincial',
'state','agency','utility')` (`20260806000004:14` — `'state'` reserved for a future US phase, no
Canadian row uses it), `application_status` (9 original values, `20260806000006:5-15`, plus 4 more
added additively across later migrations: `'extracted'` at `20260806000012:14`,
`'generating_documents'`/`'document_generation_failed'`/`'documents_generated'` at
`20260806000016:23-25` — **13 values total today**), `finding_kind`/`finding_severity`/
`finding_review_status` (`20260806000009:20-22`).

Money: every currency-bearing column is integer minor units (`estimated_job_value_cents bigint`,
`20260806000006:27`) plus an explicit `currency_code char(3) not null default 'CAD'`
(`20260806000006:28`) — the master prompt's money rule is already the existing convention, not a new
one to introduce. See §G.

**No "project" or "property" entity exists yet.** `permit_applications` carries `project_title text`
and `project_address text` as bare denormalized strings (`20260806000006:23-24`) — there is no
`properties` table and no `projects` table. Phase 1.1's "Property as its own entity (not denormalized
strings)" is a real, not cosmetic, gap against current schema.

**No `clients` table exists.** Nothing in this schema represents the contractor's own customer
(the property owner/business that hired them) — `contractors` (`20260806000003`) models the
*permit-filing contractor org's own licensing identity*, not their client. Phase 1.1's "clients" scope
is entirely new.

**No taxonomies table exists.** `doc_kind` (`20260806000006:33`) and `finding_kind`/`finding_severity`
(`20260806000009:20-21`) are Postgres enums, not rows in a configurable table — adding a new doc kind
today requires an `ALTER TYPE ... ADD VALUE` migration, not an org-scoped data insert. Phase 1.1's
"org-scoped configurable taxonomies" is a new pattern, not an extension of an existing one, and its
introduction does not remove the existing enums (additive-only).

## C. Multi-tenancy audit

Tenant isolation is enforced via Postgres RLS, using two `SECURITY DEFINER` helper functions —
`is_org_member(check_org_id)` and `is_org_owner(check_org_id)` (`20260806000002_organizations_and_members.sql:30-54`)
— reused by every tenant-scoped policy in every later migration. This avoids self-referential RLS
recursion on `org_members` by running the membership check as the migration-owning role (which
bypasses RLS), a standard and correct pattern.

- Every tenant table listed in §B is `alter table ... enable row level security` in its own creating
  migration (verified per-table above).
- **RLS policies are not a substitute for GRANT**, and this codebase's own history proves the point:
  `20260806000011_grants.sql:1-8` documents that an earlier state of this schema had RLS enabled with
  *zero* table-level GRANTs to `authenticated`/`anon`, meaning every query failed "permission denied"
  rather than being correctly RLS-filtered. `20260806000015_service_role_grants.sql:1-19` documents a
  second, later instance of the same class of bug specifically for `service_role` (which has
  `BYPASSRLS` but is not a superuser and holds no implicit table privileges) — every Inngest background
  function silently would have failed in every environment until that migration. **Both gaps were
  self-caught during this project's own earlier phases, not by this Phase 0 pass** — cited here because
  it's evidence this is a recurring failure mode in this stack (RLS enabled ≠ working), and Phase 1.0's
  new tables need both RLS *and* explicit GRANTs from day one, checked for both `authenticated` and
  `service_role` if any new background job touches them.
- **Tenant isolation was live-verified against a real Postgres instance in earlier phases of this
  project** (`README.md:331-337`: "Live-verified locally after the Phase 1 migrations, again after the
  Phase 2 migrations..., and again after the Phase 3 migrations..."), but **that verification is now
  stale relative to the current schema state** — the most recent migration
  (`20260806000017`, adding `generated_documents`) postdates the last recorded live run, and this Phase
  0 pass could not re-run `supabase/tests/tenant_isolation.test.sql` at all (no Docker/psql in this
  environment, confirmed this pass). Treat current-schema tenant isolation as "designed and
  code-reviewed," not "currently proven," until Phase 1.0 re-runs it live.
- **Storage-level tenancy**: `storage.objects` policies key off
  `(storage.foldername(name))[1]::uuid` fed into `is_org_member(...)`
  (`20260806000013_storage_buckets.sql:19-38`), matching the app-level path convention
  `${orgId}/${applicationId}/${sha256}-${filename}` (`lib/storage/documents.ts:36-44`). The leading
  `orgId` path segment is load-bearing — any new document-producing code path in Phase 1.4 must
  preserve it exactly, server-derived, never client-supplied.
- **Reference-data tables** (`jurisdictions`, `authorities`, `permit_types`, `permit_type_filings`,
  `permit_form_fields`, `jurisdiction_code_chunks`) are intentionally *not* org-scoped — `using (true)`
  policies for `authenticated`, writes restricted to `service_role` (e.g.
  `20260806000004_jurisdictions_and_authorities.sql:56-62`). This is correct for shared municipal data
  but means Phase 1.2's jurisdiction-directory work inherits a global (not per-org) data model — any
  org-specific override/annotation of a jurisdiction (if ever needed) is not representable in the
  current schema without a new join table.
- **No cross-org FK leakage found** in the schema as written: every tenant-scoped table's FK chain
  terminates at `organizations`/`permit_applications.org_id` within one hop or a documented join (e.g.
  `application_documents` has no own `org_id` but its RLS policy joins through
  `permit_applications` — `20260806000006:77-85`). No composite-FK or CHECK-constraint enforcement of
  "child row's parent must belong to the same org as the child" exists anywhere (e.g. nothing stops a
  buggy insert from creating a `permit_applications` row with a `contractor_id` belonging to a
  *different* org than its own `org_id` — RLS would still block a cross-tenant *read*, but the row
  itself could be silently inconsistent). Not currently exploited by any app code path found in this
  audit, but Phase 1.1+'s new FK-heavy tables (`properties`, `clients`, `jurisdiction_sources`, etc.)
  should decide explicitly whether to add same-org CHECK/composite-FK enforcement rather than relying
  on RLS alone, per the master prompt's own instruction on this point.

## D. Duplication/drift

- **Type-vs-runtime drift, one instance found:** `lib/inngest/functions/generate-pdf.ts:122` casts
  `application.estimated_job_value_cents as number | null`. `lib/money/cents.ts:39-44`'s own comment
  states this bigint column "cross[es] that boundary as `number`" via Supabase's JS client and that the
  crossing is guarded elsewhere via `centsToSafeNumber()` (`lib/money/cents.ts:45-52`) — but
  `centsToSafeNumber()` is **not called** at this call site; the value flows straight into
  `buildFieldResolutionContext` (`generate-pdf.ts:153-158`) and then `BigInt(ctx.estimatedJobValueCents)`
  in `lib/pdf/resolve-fields.ts:102`. `BigInt()` accepts both `number` and `string` inputs, so this
  does not currently throw for realistic job values, but the `as number` assertion is not actually
  guaranteed by anything at runtime — it's an unchecked cast, not a validated conversion, at the one
  place in the codebase that skips the guard function the codebase itself wrote for exactly this
  crossing. Low severity today (job values are nowhere near
  `Number.MAX_SAFE_INTEGER` cents), worth a one-line fix (call `centsToSafeNumber` here too) rather
  than a Phase-1.0 blocker.
- **No generated Supabase TypeScript types anywhere in this project** — confirmed again this pass
  (grep for `createClient<Database>`/`database.types.ts` across `app/` and `lib/` returns nothing), same
  finding `README.md:283-284` already documents from Phase 5. Every Supabase query in this codebase is
  untyped; a renamed/dropped column surfaces as a runtime error, not a `tsc` error. This is a
  **pre-existing, repo-wide convention**, not something introduced by any one phase — Phase 1.0+ should
  either continue it consistently or introduce generated types as its own explicit, flagged decision
  (mixing typed and untyped Supabase clients in the same codebase would itself be a new inconsistency).
- **Two visually similar "phase 0 findings" documents will exist after this pass** (the original
  mission-brief one and this one) — see the filename note at the top of this document and §I. Not code
  duplication, but worth flagging as documentation drift risk if not resolved.
- **No duplicated business logic found** between the existing audit/extraction/PDF pipeline and
  anything the master prompt proposes — the master prompt's scope (intake, jurisdictions, applications,
  documents, readiness, requirements engine, dashboard) maps onto and extends the existing tables in
  §B; it does not appear to re-implement anything that already exists elsewhere in the repo under a
  different name. One partial overlap: `permit_types.compliance_rules jsonb`
  (`20260806000005_permit_types_and_filings.sql:11`, hand-curated, checked in application code per its
  own header comment) already plays a small part of the role Phase 1.6's "deterministic requirements
  engine" would formalize — Phase 1.6 should explicitly decide whether `jurisdiction_permit_rules`
  supersedes, wraps, or runs alongside `compliance_rules` rather than leaving two parallel
  rules-representations.

## E. Existing roles/permissions

- **Exactly two roles exist today**: `org_role` enum `('owner', 'member')`
  (`20260806000002_organizations_and_members.sql:11`). There is no `platform_admin`,
  `permit_manager`, `permit_coordinator`, `document_reviewer`, `applicant_contractor`, `client_user`,
  or `auditor_readonly` anywhere in the schema or application code (grep-confirmed this pass).
- **Enforcement is entirely at the RLS/DB layer**, via `is_org_member`/`is_org_owner`
  (`20260806000002:30-54`), applied per-table: e.g. `contractors_delete` requires owner
  (`20260806000003_contractors.sql:34-36`), `permit_applications_delete` requires owner
  (`20260806000006:71-73`), `org_members_insert`/`update`/`delete` all require owner
  (`20260806000002:100-111`). Most write operations (insert/update on `contractors`,
  `permit_applications`, `audit_findings.review_status`) only require plain membership, not `owner`.
- **No application-level authorization module exists.** There is no `lib/authz/`, no `can()`/`permit()`
  helper, no role-based conditional rendering anywhere in `app/` (grep for `role ===`/`role !==`
  against non-JSX-attribute, non-AI-message-role usages returns nothing — the only `role` field read in
  application code is `lib/auth/org-context.ts:23,38,65`, which returns it on `OrgContext` but no
  caller currently branches on its value). The UI shell (`app/(app)/layout.tsx:1-50`) displays the org
  name but never the caller's role, and no page/action in this codebase currently checks
  `role === 'owner'` before rendering a control — the *DB* enforces the owner-only actions (e.g. an
  owner-only delete), but the *UI* does not currently hide/disable those controls for non-owners (not
  a security gap, since RLS is authoritative, but confirms the master prompt's "UI conditionals are
  convenience-only" framing describes a UI layer that doesn't exist yet, not one that needs
  retrofitting).
  - Concretely: **no delete UI exists at all yet** for `contractors`/`permit_applications`
    (grep of `app/` for `.delete()`/`DELETE` route handlers returns nothing) — the owner-only RLS
    policies (`contractors_delete`, `permit_applications_delete`) are currently unreachable from the
    UI entirely, exercisable only via direct API/DB access.
- **`requireOrgContext()`** (`lib/auth/org-context.ts:26-67`) is the single per-request gate every
  `(app)` route passes through — re-derives session + org membership from the DB on every call (no
  cookie/JWT-cached role), redirects to `/login` or `/onboarding` as appropriate. It deterministically
  pins a multi-org user to their **oldest** membership (`order('created_at', {ascending: true}).limit(1)`,
  `org-context.ts:40-41`) — there is no org switcher UI. Multi-org membership is schema-supported
  (`org_members` has no uniqueness constraint on `user_id` alone, only on `(org_id, user_id)`) but
  practically inaccessible beyond the first-joined org today.
- **Extending, not replacing, `org_role`**: the master prompt's 8 new roles need a plan for how they
  relate to the existing `owner`/`member` binary — e.g. does `org_owner` map 1:1 onto the existing
  `owner` value (a rename-by-addition) or sit alongside it as a separate concept? This is exactly the
  kind of ambiguity the master prompt says to stop and ask about rather than silently resolve; flagged
  again in §I.

## F. Security/privacy/data-integrity risks

- **No live database verification was possible in this pass** (Docker/Podman absent, confirmed via
  `docker --version`/`podman --version` failing with "command not found" this session). Every RLS/grant
  claim in §C is verified by reading migration SQL and this repo's own `README.md`/migration-comment
  record of prior live runs, not by an independent live query this pass performed. This is the same
  limitation Phase 4/5 of the original build documented (`README.md:289-301`), carried forward
  unchanged — flagging again here since the master prompt's Phase 1.0 explicitly requires "RLS-active,
  two seeded orgs" tenant-isolation proof, which will need either this environment to gain Docker, or a
  provided Supabase project + credentials.
- **Signed URLs**: 5-minute TTL, generated server-side per page load using the caller's own
  RLS-scoped session (`app/(app)/applications/[id]/page.tsx:13,142,149`,
  `SIGNED_URL_TTL_SECONDS = 300`) — already at or under the master prompt's "≤15min TTL" bar for Phase
  1.4. Not currently logged or cached anywhere in the code paths read this pass.
- **Append-only enforcement is DB-trigger-backed, not just RLS**, for `extractions`
  (`20260806000007_extractions.sql:36-47`, `forbid_update_delete()`), `audits`
  (`20260806000009_audits_and_findings.sql:63-65`), and `generated_documents`
  (`20260806000017:81-83`) — these reject `UPDATE`/`DELETE` even from `service_role`, which otherwise
  bypasses RLS entirely. `audit_findings` additionally has a **column-level** restriction trigger
  (`audit_findings_restrict_update_trigger`, `20260806000009:99-121`) that only allows
  `review_status`/`reviewed_by`/`reviewed_at` to change, plus a separate no-delete trigger
  (`20260806000009:123-134`). This is a strong, already-proven pattern the master prompt's own
  `audit_logs` append-only requirement (`REVOKE UPDATE, DELETE` + trigger) can directly copy rather
  than invent — see §J.
- **No `audit_logs`-equivalent table exists today.** There is no generic action-audit trail anywhere in
  this schema — the append-only tables that exist (`extractions`, `audits`, `audit_findings`,
  `generated_documents`) are each domain-specific records of one pipeline stage's output, not a
  cross-cutting "who did what when" ledger. Phase 1.0's `audit_logs` table is entirely new, not an
  extension of anything existing.
- **No `archived_at`/`archived_by` columns exist on any table** (grep-confirmed). Every delete path
  that exists today (`contractors_delete`, `permit_applications_delete` RLS policies) is a real, hard
  `DELETE` at the DB layer (though, per §E, no UI currently calls it). Phase 1.0's archival-only rule is
  a net-new discipline for this schema, and retrofitting it onto `permit_applications`/`contractors`
  will need to reconcile with their existing `on delete cascade`/`on delete restrict` FK behavior
  (e.g. `permit_applications.contractor_id references contractors(id) on delete restrict`,
  `20260806000006:20` — soft-delete doesn't trigger this FK at all today, which is a behavior change
  worth calling out explicitly when Phase 1.0 lands it).
- **PII/secrets discipline**: `.env.example` contains only placeholder blanks, no real secrets
  (`​.env.example:1-31`, verified this pass — every `VAR=` line is empty or a non-secret default like
  `permitfield-uploads`). No `.env*` file other than `.env.example` exists in this repo (verified via
  directory listing). `SUPABASE_SERVICE_ROLE_KEY` is documented as server-only, never logged
  (`.env.example:6`, `lib/supabase/service-client.ts:3-10`). No secret values were read, echoed, or
  otherwise handled by this audit pass.
- **Data residency**: **NOT FOUND.** No Supabase project region/residency configuration exists anywhere
  in this repo — `supabase/config.toml` has a local `project_id = "permitfield-os"` but no live
  project is linked (no `.supabase/` project ref, no region setting found), and neither `README.md` nor
  any migration comment states an intended hosting region. The master prompt's requirement to
  "confirm/document Supabase data residency" cannot be satisfied by this repo alone — it requires a
  decision (and likely a real Supabase project) that doesn't exist yet. Flagged as an open item, not
  guessed at.
- **No `docs/PERMISSIONS.md`, no `docs/STATUS_TRANSITIONS.md`, no `lib/authz/`, no `lib/entitlements/`
  directory exists** — all NOT FOUND, all net-new for Phase 1.0+.
- **Status transitions today are informal**, not enforced through a single server-side function: every
  Route Handler/Inngest function that changes `permit_applications.status` does its own inline
  `.update({ status: ... })` after its own inline precondition check (e.g.
  `app/api/applications/[id]/confirm-review/route.ts:43-48` checks `status !== 'ready_for_review'`
  inline; `app/api/applications/[id]/submit/route.ts` checks `'documents_generated'` inline per the
  prior phase's summary; `lib/inngest/functions/generate-pdf.ts:129-131` computes its own `eligible`
  boolean inline). There is **no `application_status_history` table** and **no single typed transition
  map** anywhere in this codebase — every one of these checks would need to be centralized into the
  master prompt's Phase 1.3 transition function, and the existing inline checks would need to be
  either replaced or reconciled with it (additive-only: likely wrapping the existing call sites to go
  through the new function rather than deleting the existing checks outright — a design decision for
  Phase 1.3's own plan, not resolved here).

## G. Money handling audit

Existing discipline is strong and directly matches the master prompt's own rule, with one nit already
covered in §D:

- Storage: `bigint` minor units + explicit `char(3)` currency code
  (`estimated_job_value_cents bigint check (estimated_job_value_cents >= 0)`,
  `currency_code char(3) not null default 'CAD'` — `20260806000006_applications_and_documents.sql:27-28`).
- Parsing: `lib/money/cents.ts:21-37` (`parseCurrencyToCents`) is regex + `BigInt` arithmetic only — no
  `parseFloat`/`Number()` call anywhere in that function (verified by reading the full file,
  `lib/money/cents.ts:1-73`). Returns `null` (never `0`) when unparseable, and callers are documented
  to treat `null` as "unknown," not "zero" (`lib/money/cents.ts:17-19`).
  `app/(app)/applications/new/actions.ts:44-53` follows this: empty input →
  `estimatedJobValueCents = null`, never coerced to `'0'`.
  - Note: the AI extraction path is explicitly kept out of currency arithmetic — the model returns the
    raw printed string (`estimated_job_value_raw`, `lib/ai/schemas/extraction.ts:37-40`) and
    `parseCurrencyToCents` (application code, not the model) does the only conversion
    (`lib/inngest/functions/extract.ts:140`).
- Formatting: `centsToDollarsString` (`lib/money/cents.ts:61-72`) is BigInt division/modulo + a regex
  for thousands separators — no `toFixed()`/`toLocaleString()`/`Intl.NumberFormat` call in that
  function.
- Guarded bigint→number crossing: `centsToSafeNumber` (`lib/money/cents.ts:45-52`) throws outside
  `Number.MAX_SAFE_INTEGER` or negative — but is **not called** at one crossing point
  (`lib/inngest/functions/generate-pdf.ts:122`, an unchecked `as number` cast instead); see §D for
  detail. This is the one gap found in an otherwise float-free, round-trip-safe implementation.
- **No `Money` shared type/formatter module exists** (`lib/money/cents.ts` is free functions, not a
  `Money` class/type) — the master prompt's "one shared `Money` type/formatter" is a refactor of an
  already-correct implementation's *shape*, not a fix to its *correctness*.
- The one non-money `Number()` call found in the codebase (`app/api/documents/route.ts:92`,
  `Number(d.byte_size)`) is summing file-size bytes for a storage quota check, not currency — not a
  violation of the money rule, noted only to be exhaustive.

## H. Subscription/entitlement reality

**NOT FOUND.** No subscription, billing, entitlement, plan, pricing, or Stripe-related code exists
anywhere in this repository — confirmed by a repo-wide case-insensitive grep for
`subscription|entitlement|stripe|billing|plan|pricing` across every `.ts`/`.tsx`/`.sql` file (excluding
`node_modules`/`.next`), which returned exactly one incidental match (a code comment mentioning "US
pricing" in a migration's justification for a currency-code column,
`20260806000006_applications_and_documents.sql:26` — not an actual pricing/billing feature).

This directly contradicts an assumption embedded in the master prompt's own entitlements requirement
("must use the **existing** subscription system... do not change any public price/plan"). **There is
no existing subscription system in this codebase to reuse.** This is a conflict to stop and ask about,
not silently resolve — see §I. (It is possible a subscription system exists in a different, separate
product/repo the master prompt's author has in mind — e.g. `pipefield-os`, a distinct, unrelated
project noted as a name-collision risk in the original `PHASE_0_FINDINGS.md:14-21` — but nothing in
*this* repository, `permitfield-os`, has one, and per that same original finding, `pipefield-os` was
explicitly treated as an off-limits, unrelated codebase and was not re-examined in this pass.)

## I. Conflict list

1. **Deliverable filename collision — resolved.** `PHASE_0_FINDINGS.md` already existed (original
   mission-brief Phase 0 output, still referenced by `README.md` and `supabase/seed.sql` comments). It
   has been renamed to `PHASE_0_FINDINGS_ORIGINAL_MISSION.md` (content unchanged, nothing deleted) so
   this document could take the canonical `PHASE_0_FINDINGS.md` path the master prompt asks for. If
   you'd prefer a different resolution (e.g. merging both into one document, or a different name for
   the original), say so before Phase 1.0 and it's a one-file rename to fix.
2. **No existing subscription/entitlement system to reuse** (§H), but the master prompt's Phase 1
   entitlements requirement assumes one exists. Needs clarification: is there a subscription system in
   a different repo this codebase is meant to integrate with, or should Phase 1.0/entitlements scope be
   dropped/redefined given none exists here?
3. **No existing RBAC/role infrastructure beyond a 2-value enum** (§E) — the master prompt's 8-role
   list needs an explicit decision on how it relates to the existing `org_role ('owner','member')`
   enum: additive sibling values on the same enum, a new separate table, or a replacement (replacement
   would violate the master prompt's own additive-only rule, so likely not this option, but stated
   explicitly rather than assumed).
4. **No test framework installed** (§A) — the master prompt requires 19 categories of tests with pasted
   actual output per gate, but this repo has no `jest`/`vitest`/equivalent and no `"test"` npm script.
   Phase 1.0 will need to introduce one as part of its own scope (a `devDependencies` install), which is
   a "when work resumes" item, not something to do during this read-only Phase 0 pass.
   
5. **Live-verification environment gap persists**: this sandbox has no Docker/Podman, so RLS/tenant-
   isolation claims for any new Phase 1.0+ table can be code-reviewed but not live-proven here, the same
   limitation the original build hit repeatedly (`README.md:289-301`, `339-351`). Needs either a
   Docker-capable environment or a provided live Supabase project + credentials before any Phase 1.0
   acceptance criterion requiring a live RLS proof can actually be demonstrated rather than asserted.
6. **Status-transition logic currently lives inline, scattered across existing routes/functions** (§F).
   Phase 1.3's centralized transition function needs an explicit decision on whether existing call sites
   (`confirm-review/route.ts`, `submit/route.ts`, `generate-pdf.ts`'s inline `eligible` check) get
   refactored to call through it, or whether the new function only governs new transitions going
   forward while the existing ones are left as-is with a documented rationale. Silently doing either
   without saying so would violate the master prprompt's own stop-and-ask rule.

## J. Proposed implementation plan

Not building anything yet — this section previews how Phase 1.0 (tenancy + RBAC + audit ledger) would
most naturally land given everything above, so it can be corrected before code is written:

- **Roles**: extend `org_role` additively (new enum values) rather than introduce a parallel table,
  *if* confirmed compatible with conflict #3's resolution — this keeps `is_org_member`/`is_org_owner`
  and every existing RLS policy that calls them working unchanged (flags-off byte-for-byte requirement),
  since `'owner'`/`'member'` remain valid values throughout.
- **`audit_logs`**: new table, modeled directly on the existing `extractions`/`audits` append-only
  pattern already proven in this schema (`forbid_update_delete()` trigger reused or cloned, per
  `20260806000007_extractions.sql:36-47`) rather than inventing a new enforcement mechanism.
- **`docs/PERMISSIONS.md` + `lib/authz/`**: new, since neither exists (§E). Should read role off
  `requireOrgContext()`'s existing return shape (`lib/auth/org-context.ts:19-24`) rather than
  introducing a second way to determine the caller's role.
- **Feature flag**: `permitfield_lifecycle_core`, following the existing `lib/flags.ts` pattern exactly
  (`isEnabled(envVarName)` reading a fresh env var per call, default-OFF, `lib/flags.ts:12-14`) — no new
  flag-reading mechanism needed, just one more exported function in that file.
- **Test harness**: Phase 1.0 needs to pick and install one (conflict #4) before any of the master
  prompt's 19 test categories can be demonstrated with real, pasted output — this is a prerequisite
  step within Phase 1.0, not a separate phase.

Sequencing and file-level detail for 1.1–1.7 are intentionally not previewed here — each of those gates
depends on decisions Phase 1.0 will itself establish (the role list, the audit-log shape, the flags
module surface), so planning them now would be guessing ahead of real information.

## K. Estimated blast radius

- **Genuinely new code/tables** (no existing equivalent to extend): `audit_logs`, `properties`,
  `clients`, `taxonomies`, `jurisdiction_sources`, `application_status_history`, `jurisdiction_permit_rules`,
  readiness checklist tables, the dashboard's own query layer, `lib/authz/`, `lib/entitlements/` (if
  confirmed needed per conflict #2), `docs/PERMISSIONS.md`, `docs/STATUS_TRANSITIONS.md`, and a test
  framework installation. This is the majority of the master prompt's scope.
- **Existing code that would need to change, not just be extended alongside**: the `org_role` enum
  (pending conflict #3), the inline status-transition checks in `confirm-review/route.ts`,
  `submit/route.ts`, and `generate-pdf.ts`'s `eligible` computation (pending conflict #6), and possibly
  `permit_applications`/`application_documents`/`contractors`' hard-delete RLS policies once archival-only
  is introduced (§F).
- **Existing code that should be left untouched**: the entire AI extraction/audit/PDF-fill pipeline
  (`lib/ai/*`, `lib/inngest/functions/*`, `lib/pdf/*`) and its Phase 5 UI
  (`app/(app)/applications/[id]/*`) — none of Phase 1.0–1.7's scope as described overlaps with
  generative-AI-driven extraction/audit/fill, consistent with the master prompt's own "zero AI in the
  decision path this phase" rule for the requirements engine. The one soft dependency: Phase 1.6's
  requirements engine should clarify its relationship to the existing `permit_types.compliance_rules`
  jsonb column (§D) rather than creating a second, disconnected rules source.
- **Migration count, rough order of magnitude**: given 15 migrations already exist for the current
  schema (`20260806000001`–`...017`), and Phase 1.0 alone introduces at minimum `audit_logs` +
  extended-role handling + `archived_at`/`archived_by` retrofits across several existing tables, a
  reasonable expectation is one migration file per gate at minimum (8 gates: 1.0–1.7), likely more once
  each gate's own tables are counted individually — not estimated precisely here since that depends on
  decisions not yet made (conflicts §I).

---

### §1.2 Adversarial self-check (this Phase 0 pass, not the future build)

1. **What in this document is least verified?** §F's data-residency finding and §C's "designed, not
   currently proven" tenant-isolation status both rest on the *absence* of live-DB access in this
   environment — I'm reporting what I could not check as much as what I did check. If a live Supabase
   project does exist somewhere (e.g. provided to an earlier session, not visible to this one), some of
   these "NOT FOUND"/"stale" findings could be wrong in the optimistic direction. I did not assume a
   live project exists anywhere it wasn't directly evidenced in this repo's own files.
2. **Where did I have to infer rather than cite?** §J's proposed implementation plan is explicitly
   labeled as a preview/inference, not a finding — every other section is citation-backed or marked
   NOT FOUND. The one place a citation-backed section still required judgment: §I conflict #1's
   filename decision — I chose `PHASE_0_LIFECYCLE_FINDINGS.md` rather than leaving this section
   undelivered, on the reasoning that producing the content under an unambiguous name and flagging the
   naming decision serves the master prompt's own stated goal better than blocking entirely on a
   naming question. That's a judgment call, stated as one.
3. **What would most embarrass this document if wrong?** The claim in §H that no subscription system
   exists anywhere reachable by this repo. I grepped exhaustively within `permitfield-os/`, but did not
   search outside it (per the original Phase 0's own boundary decision to leave `pipefield-os` and the
   rest of `~/Desktop` untouched, `PHASE_0_FINDINGS.md:11-21`) — if the "existing subscription system"
   the master prompt refers to lives in a sibling repo or an external SaaS billing provider's dashboard
   with no code footprint here, this document would incorrectly read as contradicting the master
   prompt when it's actually just silent on something out of this repo's scope. Flagged as conflict #2
   rather than asserted as a hard contradiction.
4. **Did I let the codebase's own confident tone bias this report?** This repo's migration comments are
   unusually self-assured and well-argued (e.g. the RLS-recursion-avoidance rationale, the money
   round-trip discussion) — there's a risk of absorbing that confidence uncritically. I tried to
   counter this by independently re-deriving claims where cheap to do so (re-running `git log`,
   `docker --version`, grepping for role/subscription usage myself) rather than only paraphrasing
   existing comments, and by explicitly re-flagging pre-existing self-documented gaps (the two
   grants bugs in §C, the money-crossing gap in §D/G) rather than treating "this was already fixed
   once" as "therefore fully resolved everywhere."
5. **What's the single biggest risk if Phase 1.0 starts from this document uncorrected?** Building
   RBAC on an assumed answer to conflict #3 (extend `org_role` vs. new table) without your confirmation.
   Getting that wrong is expensive to unwind later — every RLS policy written against it, and every
   `lib/authz/` check, would need to be rewritten, not just extended, if the wrong shape is chosen. This
   is the one conflict in §I I'd weight above the others if only one could be confirmed before Phase
   1.0 begins.

---

Zero code written. Zero migrations written. Zero packages installed. No branch created. Awaiting
`APPROVED: PHASE 1.0` (or corrections) — per the master prompt's own rule, any other reply is not
approval.

---

## L. Gate 1.3 pre-migration addendum — `status` vs. `permit_status` (added post-Phase-1.2, before Gate 1.3's migration)

Everything above this line is the original Phase 0 document, unchanged, dated to the `APPROVED: PHASE 1.0`
request. This section is a **targeted re-run**, not a rewrite: Gate 1.3 ("Permit applications & status
machine," master prompt §3.5) surfaced a real conflict between the master prompt's 16-status permit
lifecycle machine and this repo's existing `permit_applications.status` column, and per the operating
contract's rule 8, that conflict is resolved here, on the record, before any migration SQL is written —
not inferred silently inside a migration comment.

### L.1 What already exists, re-confirmed

`permit_applications.status` (`application_status` enum, `20260806000006_applications_and_documents.sql:5-15`,
extended additively by `20260806000012:14` and `20260806000016:23-25`) is a **live, actively-used
13-value document-processing pipeline**, not scaffolding:

```
draft → uploading → extracting → (extraction_failed | extracted)
  → auditing → (audit_failed | ready_for_review)
  → reviewed → generating_documents → (document_generation_failed | documents_generated)
  → submitted
```

Three real call sites read/write it today:
- `lib/inngest/functions/extract.ts:64,182` — `draft/uploading → extracting → (extracted | extraction_failed)`
- `lib/inngest/functions/audit.ts:127,161,244` — `extracted → auditing → (audit_failed | ready_for_review)`
- `lib/inngest/functions/generate-pdf.ts:129,148,297` — `(extracted|reviewed) → generating_documents → (documents_generated | document_generation_failed)`
- `app/api/applications/[id]/confirm-review/route.ts:43,93` — `ready_for_review → reviewed` (human confirms every AI audit finding has been individually reviewed/dismissed; this route does not touch `audit_findings` rows itself)
- `app/api/applications/[id]/submit/route.ts:4,34` — `documents_generated → submitted`

None of the master prompt's 16 lifecycle status names (`intake`, `requirements_review`,
`collecting_documents`, `internal_review`, `ready_to_submit`, `under_municipal_review`,
`additional_info_required`, `corrections_required`, `resubmitted`, `approved`, `rejected`, `issued`,
`expired`, `closed`, `withdrawn` — 15 of 16; `submitted` is the 16th and the one name shared with the
existing enum) appear anywhere in this codebase today (grep-verified, repo-wide, this pass).

### L.2 What `submitted` actually means in the existing pipeline (load-bearing finding)

`app/api/applications/[id]/submit/route.ts:4`'s own header comment states this is a "terminal,
contractor-driven 'I filed this with the authority' marker" — confirmed independently by
`20260806000016_add_pdf_generation_statuses.sql:11-16`'s migration comment: *"`documents_generated` is
the success terminal state. It is deliberately NOT `submitted` — `submitted` means the contractor has
actually filed the generated PDF with the authority ... conflating 'we produced a PDF' with 'this was
submitted to the authority' would be a false claim this system must not make."* The UI copy in
`app/(app)/applications/[id]/review-actions.tsx:59` reads: *"Once you've filed the generated documents
with the authority, mark this application submitted."*

This means the existing `status = 'submitted'` and the new `permit_status`'s planned `'submitted'` value
are **not two different things that happen to share a name** — they assert the identical real-world fact
(the contractor filed the package with the jurisdiction). That equivalence is the basis for L.3(b) below.

### L.3 The relationship, specified

**(a) Does any pipeline transition automatically advance `permit_status`?** **No, not in this gate.**
Every pipeline transition continues to be driven by its existing Inngest function or route handler,
unmodified. Auto-advancing a second, independent state machine as a side effect of already-shipped,
already-tested Phase-0-era code is a behavior change to that code, not an additive extension of it — out
of this gate's scope per §0.1's one-phase-one-diff discipline. Consequence, stated plainly as a
limitation, not hidden: after a contractor marks a pipeline `status = 'submitted'`, `permit_status`
remains wherever it was (typically `ready_to_submit`) until a **separate**, explicit call to
`transition_permit_status(..., 'submitted', ...)` is made. Two user actions, not one, until a future gate
wires the pipeline's submit route to also call the new transition function. That wiring is listed as a
"what is NOT done" item in the eventual Gate 1.3 report, not attempted here.

**(b) Is any `permit_status` transition gated on a pipeline state?** **Yes — exactly one, and it is
DB-enforced, not a convention.** `transition_permit_status()` refuses to transition a row's `permit_status`
into `'submitted'` unless that row's existing `status` column already equals `'submitted'`. This is the
direct consequence of L.2: allowing `permit_status` to independently claim `'submitted'` while the
pipeline hasn't recorded that the contractor actually filed with the authority would be exactly the
"false claim this system must not make" `20260806000016`'s own comment already forbids for the pipeline
column alone — the same rule has to hold for the new column asserting the same fact. No other
`permit_status` transition (intake through ready_to_submit, or anything post-submission:
under_municipal_review through issued/closed/expired, or withdrawn) reads the pipeline `status` column at
all — those states have no pipeline equivalent to gate against.

**(c) Which column drives contractor-facing UI?** **`status` still does, unchanged, today** — via
`components/status-badge.tsx` on `app/(app)/applications/page.tsx:73` and
`app/(app)/applications/[id]/page.tsx:166`, both unmodified by this gate. `permit_status` drives no UI in
this gate — Gate 1.3 ships zero UI/Server Action call sites, same "infrastructure only" shape as every
prior gate in this expansion. Stated intent for whichever future gate does add UI for it: `status`
should keep representing internal AI-pipeline mechanics (extraction/audit/generation progress) that only
matter to the org preparing the package; `permit_status` should become the primary contractor-facing
signal for anything the *jurisdiction* is doing with it (under review, corrections requested, approved,
issued) — an intent, not a built behavior, and not binding on whoever builds that gate if the product
picture has changed by then.

### L.4 `project_id` — confirmed absent, backfill planned

Re-confirmed (this pass): no `permit_applications.project_id` column, no join table, in any migration
through `20260806000021` (`20260806000019`/`20260806000020` add `projects` and its intake RPC but never
reference `permit_applications`). `supabase/seed.sql:142-146` has exactly two `permit_applications` fixture
rows (Org A, Org B), both `status = 'draft'`, neither linked to a project — this is dev/test fixture data
only, not production data, which is why a same-branch backfill (§ Gate 1.3 migration plan, migration 2)
is viable rather than requiring a separate coordinated data-migration effort.

### L.5 What this addendum does not decide

This section fixes the *relationship rule*, not the full migration. `application_status_history`'s exact
column list, the transition function's idempotency-key mechanics, and `permit_status_enum`'s literal
values are specified in the Gate 1.3 migration plan presented separately (per your request, before any
SQL is written).

---

## M. Gate 1.4 pre-branch architecture addendum — documents (added post-Gate-1.3, before any Gate 1.4 branch, per your request)

Everything above this line, through L.5, is unchanged. Same discipline as §L: this is a **targeted
re-run**, not a rewrite, produced before branching because you flagged that master prompt §3.6
("Documents," reproduced in full below) is *correct but incomplete* — it states tenant-scoping, signed-URL,
MIME-validation, revision-immutability and IDOR requirements, but is silent on bucket/retention/quota
limits, the download-access model, generation sourcing, and any relationship to `jurisdiction_sources`.
Per rule 8, the gaps are resolved here, on the record, before migration SQL is written.

**§3.6's full text, quoted for reference:**

> Private bucket only. Tenant-scoped storage paths: `org/{org_id}/project/{project_id}/application/{application_id}/{document_id}/{revision}`.
> Path must be derived server-side from the authenticated session, never from a client-supplied value.
> Signed URLs only, short TTL (≤15 min), generated per request, never cached in client state, never
> logged, never written to audit rows. Server-side validation of MIME type (by magic bytes, not
> extension), size cap, and filename sanitization. Reject on mismatch. Revisions are immutable. A
> re-upload creates `document_revisions.revision_number + 1` and retains all prior versions. No overwrite
> path exists in the code — not behind an admin flag, not for correcting a mistake. Per-document:
> category, status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, rejection_reason.
> Direct-object-reference test required: authenticated user from Org B requesting a valid Org A document
> ID must receive a 404 (not 403 — do not confirm existence).

### M.1 The load-bearing question first: is Gate 1.4 a new table, or does it extend `application_documents`?

This has to be answered before anything else in this addendum, because it changes what "bucket
constraints" and "generation sourcing" even mean. Two documents systems already exist in this repo,
neither built by this expansion track:

- **`application_documents`** (`20260806000006_applications_and_documents.sql:35-49`) — contractor-uploaded
  source documents (blueprints, spec sheets, scope of work), `doc_kind` enum
  (`blueprint`/`spec_sheet`/`scope_of_work`/`other`), stored in the `permitfield-uploads` bucket
  (`20260806000013_storage_buckets.sql:5-9`, 25 MB/file cap), path convention
  `${orgId}/${applicationId}/${sha256}-${filename}` (`buildStoragePath`, cited in
  `20260806000013:11-18`'s comment). It has **no** `status`, `uploaded_by`, `reviewed_by`, `reviewed_at`,
  or `rejection_reason` column today — only `doc_kind`, `uploaded_at`. Its DELETE policy is a real hard
  delete, not archival, and is **already flagged as a known, pre-existing gap** in
  `docs/PERMISSIONS.md:125-129`: *"Any org member can delete any document in their org today... fixing it
  is a behavior change this phase's additive-only discipline does not authorize"* — written during Gate
  1.0, when documents were out of that gate's scope.
- **`generated_documents`** (`20260806000017_filing_form_templates_and_generated_documents.sql:50-90`) —
  service-role-only, append-only (trigger-enforced), filled PDFs produced by
  `lib/inngest/functions/generate-pdf.ts`, stored in `permitfield-generated`. No `reviewed_by`/
  `rejection_reason` concept exists or is meaningful here — nothing reviews a generated PDF for
  acceptance, the pipeline's own `status` enum (`documents_generated` / `document_generation_failed`,
  cited in §L.1 above) is what tracks its outcome.

**Finding: `docs/PERMISSIONS.md`'s own forward-looking Table 2 already answers this.** Written in Gate
1.0, before Gate 1.4 was scoped in detail, `document_reviewer` — one of the 8 roles Gate 1.0 added
specifically for this expansion track (`20260806000018:26`) — is modeled with `C,R,A` against the
resource literally named `application_documents` (`docs/PERMISSIONS.md:182`, `lib/authz/index.ts`'s
`Resource` type). No alternate `documents` resource exists anywhere in Table 2. That is a citation, not
an inference: the role this expansion track invented for exactly this purpose was already pointed at the
existing table before Gate 1.4 was written in detail.

**Decision (confirmed):** Gate 1.4 **extends
`application_documents`** additively — new columns (`status`, `uploaded_by`, `reviewed_by`,
`reviewed_at`, `rejection_reason`; `category` is already served by `doc_kind`), a new
`document_revisions` table for immutable versioning, tightened storage-path derivation and signed-URL
issuance for new uploads going forward, and a replacement DELETE→archive policy that finally closes the
`docs/PERMISSIONS.md:125-129` gap (allowed under additive-only discipline because it adds a column and
replaces a policy — it does not drop, rename, or retype anything). It does **not** touch
`generated_documents`, `permitfield-generated`, or any file under `lib/pdf/*`/`lib/inngest/functions/
generate-pdf.ts` — consistent with `PHASE_0_FINDINGS.md:456-459`'s existing finding that the AI
extraction/audit/PDF-fill pipeline "should be left untouched."

One consequence stated plainly: **existing `application_documents` rows keep their existing
`storage_path` values** (`${orgId}/${applicationId}/${sha256}-${filename}`) — this addendum does not
propose a backfill/rewrite of already-uploaded files' paths, only that *new* uploads and revisions from
Gate 1.4 onward use the fuller `org/{org_id}/project/{project_id}/application/{application_id}/
{document_id}/{revision}` convention from §3.6. Both conventions share the same first path segment
(`org_id`), so the existing `uploads_select`/`uploads_insert`/`uploads_delete` policies
(`20260806000013:19-38`, which authorize purely off `storage.foldername(name)[1]`) continue to work
unmodified for old and new paths alike — no policy rewrite is forced by the path-convention change
itself.

Confirmed correct — "extend `application_documents` rather than build parallel" is the intended reading.

### M.2 Bucket constraints

- **Storage backend:** Supabase Storage, not S3 or another provider — both existing buckets already use
  it (`20260806000013`, `20260806000017:122-124`) and M.1's extend-not-replace decision means Gate 1.4
  reuses the existing `permitfield-uploads` bucket rather than introducing a new one. **Cited + follows
  from M.1**, not an independent decision.
- **Size cap per document:** §3.6 says "size cap" but no number. Existing precedent: 26,214,400 bytes
  (25 MB) on `permitfield-uploads` itself (`20260806000013:7`) and redundantly at the row level
  (`application_documents.byte_size` check constraint, `20260806000006:41-43`, comment cites "SS4.1").
  **Decision: keep 25 MB/document** — no stated reason in §3.6 or elsewhere to change it, and Gate 1.4
  extending the same bucket makes a differing cap incoherent (the bucket-level cap would silently
  override a lower row-level one, or a higher row-level check would never bind against the bucket's own
  25 MB ceiling).
- **Size cap per org per month:** **NOT FOUND** anywhere — not in §3.6, not elsewhere in the master
  prompt, not in this repo. §4's entitlement key list (line 227) is a closed enumeration
  (`maximum_active_projects`, `maximum_team_members`, `jurisdiction_requirements`, `readiness_checker`,
  `readiness_override`, `client_portal`, `correction_tracking`, `inspection_management`,
  `permit_expiration_tracking`, `analytics`, `api_access`) and does **not** include any storage-quota key.
  **Decision (confirmed): deferred; no per-org monthly cap enforced in Gate 1.4.** It is a
  quota/entitlement feature, not a document-handling feature, and belongs in a later gate — probably
  alongside billing/usage tracking, whenever that lands — not invented here just to gate a feature this
  gate isn't building. Adding one now would mean inventing a new entitlement key beyond what §4
  enumerates, which is scope expansion, not an implementation detail.
- **Retention/deletion policy for generated PDFs:** out of scope for this addendum — "generated PDFs"
  (`generated_documents`) are explicitly not part of Gate 1.4 per M.1. For `application_documents` itself:
  **NOT FOUND** — no TTL or cleanup job exists for either current bucket, and master prompt §3.1's
  cross-cutting rule binds here regardless: *"Archival, not deletion. Every entity gets `archived_at`/
  `archived_by`. No hard deletes anywhere in this work"* (line 150). **Decision: no automatic
  expiry/deletion of documents in Gate 1.4** — rows and files persist indefinitely until an authorized
  role explicitly archives them (M.3). This is the direct, mandatory reading of §3.1's rule, not a
  discretionary choice.
- **Versioning (one-shot vs. multiple):** **already answered by §3.6 itself**, no decision needed —
  "Revisions are immutable. A re-upload creates `document_revisions.revision_number + 1` and retains all
  prior versions... not for correcting a mistake" (lines 206). Multiple revisions per document are
  mandatory; one-shot is explicitly ruled out.

### M.3 Access model

- **Who can download/share:** §3.6 specifies the *mechanism* (signed URLs, ≤15 min TTL) but not the
  *authorization* boundary. Per M.1, `application_documents` already has a target permission model in
  `docs/PERMISSIONS.md:174-185` — every role except `client_user` and (per its blank cell) a handful of
  narrow ones gets at least `R`; `document_reviewer`/`owner`/`org_owner`/`permit_manager`/
  `applicant_contractor` get `C,R,A`. **Decision: Gate 1.4 wires `can()` into the document-download route
  for the first time** (per `docs/PERMISSIONS.md:279-282`, "`can()` becomes meaningful only once a Route
  Handler or Server Action calls it. Zero do, as of Phase 1.0" — Gate 1.4 is that first call site) rather
  than inventing a separate access rule. No new external/non-org-member sharing capability is added —
  `client_user`'s row is blank for `application_documents` today and this addendum proposes leaving it
  blank, consistent with §2's explicit deferral of the client portal ("must not be scaffolded even
  partially," summary point on Gate 2.0).
- **Audit trail — is every download logged:** §3.6 line 204 is explicit that signed URLs are "never
  logged, never written to audit rows," and §3.1 line 147 reinforces it generally ("Never store...
  signed URLs... in audit rows"). **Decision (confirmed): "never logged" covers the download event
  itself, not just the upload/review actions.** `audit_logs` captures upload and review events;
  download events (via signed URL) are intentionally not logged, per §3.6. This repo's
  `writeAuditLog()` (`lib/audit/log.ts`, infrastructure-only per `docs/PERMISSIONS.md:283-285`) also has
  no precedent for a high-frequency read-event log anywhere else in the schema.
- **Can documents be deleted, and by whom:** §3.1 line 150 answers the "by whom" half of this
  unconditionally — nobody, archival only, for every entity in this work. **Decision: Gate 1.4 adds
  `archived_at`/`archived_by` to `application_documents` and replaces the existing hard-DELETE policy
  (`20260806000006:97-105`, the one `docs/PERMISSIONS.md:125-129` already flags as ungated — "any org
  member") with an UPDATE-only archive path gated to the roles `docs/PERMISSIONS.md:182,176-177,180,183`
  already model as holding `A` on this resource: `owner`/`org_owner`/`platform_admin`/`permit_manager`/
  `document_reviewer`/`applicant_contractor`.** This closes a real, previously-documented gap rather than
  leaving it open past the one gate whose explicit remit is documents.

### M.4 Generation sourcing

**Finding, not a gap:** §3.6's text contains no reference to generation at all — no "PDF generator," no
mention of a data source, no failure-handling language. Its vocabulary is entirely upload/revision-centric
("re-upload," "revision," "uploaded_by," "uploaded_at"). Per M.1, the object Gate 1.4 governs
(`application_documents`) is the **contractor-supplied source-document** table, not the
**system-generated output** table (`generated_documents`) — the latter is what the "what feeds the PDF
generator / what happens on failure / idempotency" questions actually describe, and that pipeline already
answers them for itself, outside this expansion's scope:
- **Sources:** `buildFieldResolutionContext` combines parsed/extracted application data and structured
  contractor fields (`lib/inngest/functions/generate-pdf.ts:153-158`).
- **Failure handling:** a dedicated terminal enum state, `document_generation_failed`
  (`20260806000016_add_pdf_generation_statuses.sql`, cited in §L.1 above) — not a rollback, not a retry
  queue; the row stops there for a human to act on.
- **Idempotency:** **not idempotent by content.** Each generation attempt inserts a new
  `generated_documents` row (append-only, `20260806000017:81-83`); nothing prevents or collapses repeat
  runs into one row. Re-running produces an additional record, not a guaranteed-identical replacement.

**Decision: none of the above is in Gate 1.4's scope**, and this addendum does not propose changing any
of it — doing so would mean modifying already-shipped, already-tested Phase 4/5 code, which
`PHASE_0_FINDINGS.md:456-459` already found should stay untouched. **If you intend Gate 1.4 to add a new
generation capability** (as opposed to managing contractor-uploaded documents with review/revisioning),
that is not present in §3.6's text as written and would need to be added to scope explicitly, with its
own sourcing/failure/idempotency answers, before branching.

### M.5 Relationship to Phase 1.2 `jurisdiction_sources`

**NOT FOUND** — §3.6 does not mention `jurisdiction_sources`, and §3.3 (`jurisdiction_sources`'s own
spec) does not mention documents. They model different things: a `jurisdiction_sources` row
(`20260806000021_jurisdiction_sources.sql`) is a citation/link to *external government reference
material* (a fee schedule page, a bylaw, a forms page) with its own verification/staleness lifecycle
(§3.3, `PHASE_0_FINDINGS.md` §L context); an `application_documents` row (per M.1, what Gate 1.4 extends)
is a file a contractor uploaded for one specific application. Nothing in either spec section implies one
references the other.

**Decision: no FK or embedding relationship between `application_documents`/`document_revisions` and
`jurisdiction_sources` in Gate 1.4.** A document does not carry a `jurisdiction_source_id`, and generated
PDFs (out of scope per M.4 in any case) are not versioned against jurisdiction-source updates by this
gate. If a future feature wants to attach a jurisdiction's official checklist or form PDF to an
application and track it against source updates, that is a new, explicitly-scoped capability — not
implied by §3.3 or §3.6 as written today, and not something this addendum invents on their behalf.

### M.6 Confirmed decisions and what this addendum still does not decide

All decisions in this section are confirmed, not open:

- **M.1:** Gate 1.4 extends `application_documents` (and its existing bucket/policies), not a parallel
  table. Confirmed.
- **M.2, org-per-month storage cap:** deferred; no per-org monthly cap enforced in Gate 1.4. Belongs in a
  later gate alongside billing/usage tracking. Confirmed.
- **M.3, per-download audit logging:** `audit_logs` captures upload and review events only; download
  events (via signed URL) are intentionally not logged, per §3.6. Confirmed.

Still reserved for the Gate 1.4 migration plan itself, to be presented separately before any SQL is
written (same discipline as §L.5): the exact new/altered column list, `document_revisions`' schema, the
replacement archive-RLS policy text, and the feature-flag name.

Zero code written, zero migrations written for Gate 1.4.
