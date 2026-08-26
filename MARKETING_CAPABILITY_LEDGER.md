# MARKETING_CAPABILITY_LEDGER.md

Companion document to `MARKETING_PHASE_0_FINDINGS.md`. Every capability the
master prompt asked about is scored **SHIPPED** / **PARTIAL** / **NOT BUILT**
against real `file:line` evidence in this repository (commit `c5cfa931044e`,
branch `feat/marketing-homepage-v2`). Per hard rule: **no citation, no
claim.** Anything not listed here, or listed as NOT BUILT, may not appear in
homepage copy in any form — not as a feature, not as a roadmap teaser, not as
an implied capability.

Evidence was gathered by an Explore-agent audit and spot-checked by me
directly against `app/api/applications/[id]/submit/route.ts` and
`lib/entitlements/index.ts` (both confirmed accurate).

| # | Capability | Status | Evidence (file:line) | Marketing claim permitted |
|---|---|---|---|---|
| 1 | Permit application creation / intake flow | **SHIPPED** | `app/(app)/projects/new/actions.ts:32-172` (`createProjectAction`), RPC `create_project_with_intake` at :122, flag-gated by `isIntakeEnabled()` at :36 | Yes — "Create and track permit applications from intake through submission." |
| 2 | AI-powered document/permit-data extraction | **SHIPPED** (extraction only) | `lib/ai/extract-permit-data.ts:137-228` (live Anthropic `messages.create`, tool-forced structured output, Zod-validated, fails closed); `lib/inngest/functions/extract.ts:20-209` (Inngest trigger `permit/application.documents_ready`) | Yes, narrowly — "AI extracts key permit-application data from uploaded documents." **Not** permitted: any claim it determines compliance or fully "auto-fills your application" (system prompt at `extract-permit-data.ts:17-19` explicitly forbids the model asserting compliance). |
| 3 | PDF auto-fill / AcroForm field-filling | **PARTIAL** | `lib/pdf/fill-acroform.ts:32-59` (real `pdf-lib` fill mechanism); `supabase/seed.sql:80-111` — only 3 verified AcroForm fields exist, all on the Toronto Electrical Service Upgrade form; Calgary/ESA forms explicitly have no verified field maps | Qualified only — "Auto-fills supported AcroForm permit forms (currently Toronto Electrical Service Upgrade)." **Not** permitted: "automatically fills official permit forms" as a general claim. |
| 4 | E-signature | **NOT BUILT** | Repo-wide search for signature/DocuSign/e-sign functionality: no matches. Only hits are unrelated Supabase Storage `createSignedUrl()` calls (`app/(app)/applications/[id]/page.tsx:142,149`) | No. |
| 5 | Automatic / API-based municipal submission | **NOT BUILT — confirmed by direct read** | `app/api/applications/[id]/submit/route.ts:1-51` — handler comment states verbatim it is "Deliberately has no corresponding lib/inngest/client.ts event... nothing in the system acts on 'submitted'"; body only runs `supabase.from('permit_applications').update({ status: 'submitted' })`. No outbound call, no Inngest `.send()`, no portal integration anywhere in the file | No — "automatically submits to the city" is fabricated. Honest phrasing: "Track your permit's filing status" / "Mark applications as submitted once you've filed." |
| 6 | Jurisdiction / permit-requirements database, coverage tiers | **PARTIAL** — real engine, narrow coverage | `supabase/seed.sql:14-27` (4 jurisdiction rows); `supabase/migrations/20260806000026_permit_requirements_engine.sql`, `...000027_permit_requirements_evaluator.sql`; tier gate exercised at `lib/inngest/functions/audit.ts:78,100` | Yes, narrowly — see jurisdiction table below for exact wording. Never "nationwide" or "all of Canada." |
| 7 | Readiness checker / pre-submission checklist | **PARTIAL** — DB-enforced, no UI | `supabase/migrations/20260806000025_readiness_checklist.sql:1-205` (`permit_requirement_checklist` table, `readiness_checklist_complete()`); zero matches for "readiness" under `app/` or `components/` | No, as a user-facing "checklist feature" (nothing to show a screenshot of). May say "the system enforces required checklist items before an application can move to ready-to-submit," scoped to the backend gate only. |
| 8 | Readiness override / permit_manager review workflow | **PARTIAL** — DB-enforced, no UI | `override_readiness_check()` at `20260806000025_readiness_checklist.sql:267-324` (role-gated, reason ≥20 chars, audit-logged); `review_project_permit_requirement()` at `20260806000027_permit_requirements_evaluator.sql:391-446`; no call site in `app/` | No — not reachable by any user today. |
| 9 | Multi-tenant org/team structure with roles | **PARTIAL** | 8-role enum at `supabase/migrations/20260806000018_lifecycle_rbac_roles_and_audit_log.sql:26-33`; but `lib/auth/org-context.ts:19-23` types `OrgContext.role` as only `'owner' \| 'member'`, and onboarding (`app/onboarding/actions.ts:19-49`) only ever creates single-owner orgs — no invite/member-management UI exists anywhere under `app/` | Qualified — "multi-tenant with role-based permissions" is honest at the data layer. **Not** permitted: "invite your team and assign roles" (no such UI exists). |
| 10 | Row-level security / tenant data isolation | **SHIPPED** | `is_org_member()` / `is_org_owner()` SECURITY DEFINER functions, `supabase/migrations/20260806000002_organizations_and_members.sql:30-58`; dedicated `supabase/tests/tenant_isolation.test.sql` (253 lines) | Yes — "your data is isolated by organization via row-level security." |
| 11 | Analytics / reporting dashboard | **NOT BUILT** | Five `dashboard_*()` SQL functions exist (`supabase/migrations/20260806000028_dashboard_queries.sql:65,82,109,140,169`) but zero UI calls them anywhere under `app/`; `lib/entitlements/index.ts:53-60` itself documents "No call site yet" | No. |
| 12 | Notifications (email / in-app) | **NOT BUILT** | `lib/inngest/client.ts:29-30,53-54` — event comments state verbatim "no subscriber exists yet in this codebase"; no email-sending library (Resend/SendGrid/Nodemailer) anywhere in the repo | No. |
| 13 | Background job automation (Inngest) | **SHIPPED**, narrow scope | Full event catalog `lib/inngest/client.ts:12-60`; 3 real functions: `extract.ts:20-27`, `audit.ts`, `generate-pdf.ts:29-36` | Yes, narrowly — "background processing automates document extraction, compliance audit, and PDF generation." Not a general "automation" claim beyond these three steps. |
| 14 | File / document storage | **SHIPPED** | `lib/storage/documents.ts:46-53` — 3 real Supabase Storage buckets, org-scoped RLS, 25MB/file & 100MB/application caps enforced | Yes — "securely store and organize permit documents." |
| 15 | Billing / subscription / trial system | **NOT BUILT — confirmed by direct read** | `lib/entitlements/index.ts:4-21` (verbatim: "THIS IS NOT A REAL BILLING/SUBSCRIPTION SYSTEM... no plans/subscriptions table, no billing provider integration, nothing... a single hardcoded default tier applied to every org") | No pricing, plan, or trial claims of any kind ("Start Free Trial," "No credit card required," tiered pricing, etc.) until this is built. |
| 16 | Authentication methods | **PARTIAL** | `app/login/login-form.tsx:24-33` — email/password only (`signInWithPassword`/`signUp`); comment confirms no OAuth providers enabled | Yes for "sign up with email and password." No for "sign in with Google," SSO, or passwordless. |
| 17 | Deadline / expiry tracking & alerts | **NOT BUILT** | `'expired'` is a manually-set terminal status only (`lib/permit-status/transitions.ts:41,62,86,112,115-116`); no scheduled/cron Inngest function exists; license-expiry field is a plain date input with no reminder logic (`app/(app)/contractors/new/new-contractor-form.tsx:42-45`) | No — "get alerted before your permit expires" is fabricated. |
| 18 | Audit trail / activity log | **SHIPPED**, scoped | `lib/audit/log.ts:74-105` (`writeAuditLog`); real call sites at `app/(app)/projects/new/actions.ts:155-163` (project creation) and `lib/bridge/client-portal.ts:923` (document upload); DB-enforced via CHECK constraint | Yes, scoped to actions actually wired (project creation, document upload, readiness overrides) — not "every action in the app" until more call sites exist. |
| 19 | Public API access for third-party integrations | **NOT BUILT** | All 5 `app/api/*` routes require a logged-in browser session via cookie-based `createClient()` (e.g. `submit/route.ts:13,16-17`); no API-key issuance, no `Authorization: Bearer` scheme, no OpenAPI docs anywhere in the repo | No. |

## Jurisdiction coverage (the only jurisdiction data in the repo — `supabase/seed.sql:14-27`)

| Jurisdiction | Province | Coverage tier | Verified? |
|---|---|---|---|
| Toronto | ON | **verified** | Yes |
| Calgary | AB | **verified** | Yes |
| Ottawa | ON | **assisted** | No (never verified) |
| Hamilton | ON | **listed** | No (never verified) |

Plus one non-municipal authority attached only to the Toronto Electrical
Service Upgrade permit type: Electrical Safety Authority (ESA), Ontario,
filing mechanism `pdf_email` (`seed.sql:38-41`) — not itself a jurisdiction
row.

Only **2 permit types** are seeded in total (`seed.sql:51-60`): Electrical
Service Upgrade (Toronto) and Commercial Tenant Improvement (Calgary). Of
those, only **3 AcroForm fields** on the Toronto form are verified/mapped
(`seed.sql:109-111`); Calgary's and ESA's forms have no verified field maps,
and the seed file itself contains a comment saying fabricating coordinates
"would misrepresent them as verified when they are not."

**Honest homepage phrasing:** "PermitField OS currently supports permit
filing guidance for Toronto and Calgary (fully verified), with
partial/listed support for Ottawa and Hamilton, Ontario/Alberta only."
**Forbidden:** any claim of nationwide, all-of-Canada, or multi-province-at-scale
coverage; any claim of US coverage.

## Zero-tolerance fabrication list (explicitly confirmed absent from the codebase)

These must never appear on the homepage, including as placeholders,
"coming soon" teasers implying current capability, or soft/ambiguous phrasing
that a reasonable reader would take as a present-tense claim:

- Customer testimonials, quotes, or logos (no customer data of any kind exists in this repo beyond fictional seed data)
- Customer/user counts, star ratings, review scores, "trusted by X contractors"
- Case studies or named-project success stories
- "Automatically submits your permit to the city" (§5 above)
- "AI auto-fills your entire application" unqualified (§2, §3 above)
- Any pricing, "Free Trial," "No credit card required," or plan-comparison copy (§15 above)
- "Nationwide," "all of Canada," or any coverage claim beyond the 4 seeded, 2-provinces-only jurisdictions (see table above)
- "Get notified" / "we'll alert you" copy of any kind (§12, §17 above — no notification system exists)
- "Invite your team" / role-assignment UI copy (§9 above — no such UI exists)
- Integration/API marketplace claims (§19 above)
- Any product screenshot that is not a real capture of the actual running app (§7 of `MARKETING_PHASE_0_FINDINGS.md`)

## Approved capability claims (safe to build homepage messaging around)

1. Permit application intake and status tracking, end to end (§1)
2. AI-assisted extraction of application data from uploaded documents, with human review (§2)
3. Automatic form-filling for supported forms today (Toronto Electrical Service Upgrade), expandable over time (§3, stated honestly as current + narrow)
4. Organization-scoped data isolation via row-level security (§10)
5. Automated background processing for extraction, compliance audit, and PDF generation (§13)
6. Secure, organized document storage per application (§14)
7. An audit trail covering key actions (project creation, document upload, readiness overrides) (§18)
8. Coverage today in Toronto and Calgary, with Ottawa/Hamilton in earlier support tiers (jurisdiction table above)

---

End of Phase 0. Both required deliverables (`MARKETING_PHASE_0_FINDINGS.md`
and this file) are complete. Awaiting **APPROVED: PHASE 0** before proceeding
to Phase 1 (`IMPLEMENTATION_PLAN.md` + `COPY_DECK.md`, still no code).
