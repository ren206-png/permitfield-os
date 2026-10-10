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
| 3 | PDF auto-fill / AcroForm field-filling | **SHIPPED — updated 2026-09-27, this row was stale** | AcroForm filling (`lib/pdf/fill-acroform.ts`) for Toronto, Surrey, Vancouver, Richmond, Coquitlam, Port Coquitlam and Maple Ridge, and coordinate-overlay filling (`lib/pdf/overlay-coordinates.ts`) for ESA's Form 1015LV_A (`supabase/migrations/20260806000072_esa_overlay_and_calgary_correction.sql`, 10 fields, rendered and checked). Every `maps_to` key has a resolver (guard test `lib/pdf/resolve-fields.test.ts`); AI-extracted values below 0.75 confidence are left blank. Calgary has no PDF form for commercial alterations (portal-only), so nothing is generated there. | Yes: "pre-fills the official city/ESA forms" for the 8 mapped forms. Not for Calgary, and not "fully automatic" -- low-confidence fields are left blank for review. |
| 4 | E-signature | **BUILT — updated 2026-09-26, this row was stale** | Stage A (quotes): consent, typed-or-drawn signature and a signing certificate on estimate/change-order acceptances and PDFs (`supabase/migrations/20260806000069_esignature_consent_and_signature.sql`, `components/esign/signature-field.tsx`, `lib/pdf/estimate-pdf.ts`). Stage B (permit forms): a signing link stamps the applicant's signature, name and date into the filled city form (`supabase/migrations/20260806000073_permit_form_esignatures.sql`, `lib/pdf/stamp-signature.ts`, `lib/esign/permit-signatures.ts`, `app/sign/[token]`), behind `PERMITFIELD_FF_PERMIT_ESIGN`, offered only where the authority confirms it accepts electronic signatures — today Vancouver only (its form says so); other authorities are unconfirmed. Built-in, not DocuSign-style certificate-based digital signatures. | Yes for quotes/change orders. For permit forms, only "sign Vancouver applications online"; do not claim e-signing for other cities, and do not claim certificate-based digital signatures (e.g. Surrey requires those). |
| 5 | Automatic / API-based municipal submission | **PARTIAL — updated 2026-09-27, this row was stale** | Email submission to authorities with a verified intake address (ESA and Richmond; `lib/submissions/submit.ts`, `supabase/migrations/20260806000070_authority_submissions.sql`), and recording of portal / in-person filings. Flag `PERMITFIELD_FF_CITY_SUBMISSION` is on in production, currently with a test override that routes every submission email to the owner. No city portal API integration (none of the covered authorities offers one). | "Email the filled form to ESA and Richmond from the app" once the test override is removed; do not claim portal/API submission. |
| 6 | Jurisdiction / permit-requirements database, coverage tiers | **PARTIAL** — real engine, narrow coverage | `supabase/seed.sql:14-81` (10 jurisdiction rows, updated by the jurisdiction-expansion follow-up — added Surrey, Vancouver, Richmond, Coquitlam, Port Coquitlam, and Maple Ridge, all BC); `supabase/migrations/20260806000026_permit_requirements_engine.sql`, `...000027_permit_requirements_evaluator.sql`; tier gate exercised at `lib/inngest/functions/audit.ts:78,100` | Yes, narrowly — see jurisdiction table below for exact wording. Never "nationwide" or "all of Canada." |
| 7 | Readiness checker / pre-submission checklist | **SHIPPED — updated 2026-09-27, this row was stale** | "Permit progress" panel on the application page (`app/(app)/applications/[id]/readiness-panel.tsx`, flag `PERMITFIELD_FF_READINESS`): readiness score, checklist add/complete/reject/reopen, suggested starter items; the database gates Ready to submit on it (`20260806000025_readiness_checklist.sql`, Check 5 in `transition_permit_status()`). | Yes, once the flag is on in production. |
| 8 | Readiness override / permit_manager review workflow | **SHIPPED — updated 2026-09-27, this row was stale** | Override form in the same panel for permit manager and above, 20+ character reason, recorded permanently on the application and audit-logged (`override_readiness_check()`); permit status changes limited to the legal next steps for the viewer's role (`lib/readiness/readiness.ts`). | Yes, once the flag is on in production. |
| 9 | Multi-tenant org/team structure with roles | **SHIPPED — updated 2026-09-27, this row was stale** | Settings → Team (`app/(app)/settings/team/`): invite by email, accept by signing in as that address, change role, remove, revoke; at least one owner always kept (`supabase/migrations/20260806000074_org_invitations.sql`). Roles offered: owner, permit manager, permit coordinator, member -- the ones the database enforces differently. Members of several orgs can switch. | Yes: "invite your team, with owner / permit manager / coordinator / member roles". Do not claim the other role names (auditor, document reviewer...) -- they have no distinct enforcement. |
| 10 | Row-level security / tenant data isolation | **SHIPPED** | `is_org_member()` / `is_org_owner()` SECURITY DEFINER functions, `supabase/migrations/20260806000002_organizations_and_members.sql:30-58`; dedicated `supabase/tests/tenant_isolation.test.sql` (253 lines) | Yes — "your data is isolated by organization via row-level security." |
| 11 | Analytics / reporting dashboard | **SHIPPED** — corrected 2026-09-25, this row was stale | `app/(app)/dashboard/page.tsx:1-141` calls all five `dashboard_*()` RPCs (`supabase/migrations/20260806000028_dashboard_queries.sql`) in parallel and renders real panels, gated by `isDashboardEnabled()` (`lib/flags.ts:139-140`, `PERMITFIELD_FF_DASHBOARD`) and the `analytics` entitlement (`lib/entitlements/index.ts:60`, `lib/billing/tiers.ts:55,81`); nav link in `components/app-sidebar.tsx`. `PERMITFIELD_FF_DASHBOARD` is set in Vercel Production. | Yes — "See project status, permit pipeline, readiness, and document review at a glance." |
| 12 | Notifications (email / in-app) | **SHIPPED**, narrow — corrected 2026-09-25, this row was stale | Real email send via Resend (`lib/notifications/send.ts`, `lib/email/resend-client.ts`); `lib/inngest/functions/notify.ts:93-366` (`permitNotify`/`permitNotifyFlush`) records + debounce-flushes 4 lifecycle events to real recipients, logs every send to `notification_log` (`supabase/migrations/20260806000048_notification_log.sql`); real `notifications` table (`supabase/migrations/20260806000059_notifications.sql`) backs `app/(app)/notifications/page.tsx:27-95` (real rows, working mark-read). Gated by `PERMITFIELD_FF_NOTIFICATIONS`/`isFailureNotificationsEnabled()` — **both unset in Vercel Production (default off)**, and their Resend credentials (`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`RESEND_FROM_ADDRESS`) are also unset there, so no real notification currently sends in production despite the code being complete. | Not yet — code is real but the flags are off and Resend isn't configured in production; do not claim until both are turned on. |
| 13 | Background job automation (Inngest) | **SHIPPED**, narrow scope | Full event catalog `lib/inngest/client.ts:12-60`; 3 real functions: `extract.ts:20-27`, `audit.ts`, `generate-pdf.ts:29-36` | Yes, narrowly — "background processing automates document extraction, compliance audit, and PDF generation." Not a general "automation" claim beyond these three steps. |
| 14 | File / document storage | **SHIPPED** | `lib/storage/documents.ts:46-53` — 3 real Supabase Storage buckets, org-scoped RLS, 25MB/file & 100MB/application caps enforced | Yes — "securely store and organize permit documents." |
| 15 | Billing / subscription / trial system | **PARTIAL — corrected 2026-09-25, this row was stale** | Real per-org Stripe-synced subscriptions now exist: `supabase/migrations/20260806000040_org_subscriptions.sql` (+`...42`/`...44` follow-ups), `lib/billing/tiers.ts` (Starter/Pro/Enterprise), `lib/entitlements/index.ts`'s `resolveOrgTier()`/`can()`/`limit()` now resolve a live `org_subscriptions` row when `PERMITFIELD_FF_BILLING` is on; `BILLING_PROPOSAL.md` is the ratified design. Built and tested against **Stripe test mode only** (`BILLING_PROPOSAL.md`'s own header: "switching to live keys/going live-priced remains a deliberate, separate step"). `PERMITFIELD_FF_BILLING` is unset in Vercel Production (off) — correctly, since test-mode keys in production would show real customers a checkout that cannot take real payment. | No pricing, plan, or trial claims until live Stripe keys are configured and the flag is deliberately turned on — that is a real-money decision, not a code-readiness one. |
| 16 | Authentication methods | **PARTIAL — updated 2026-09-27** | Email/password, two-factor sign-in with an authenticator app (`app/(app)/settings/security/`, enforced in `proxy.ts`), and Google/Microsoft buttons that appear only when those providers are enabled in Supabase (`lib/auth/oauth-providers.ts`) -- neither is enabled in production yet. | "Two-factor sign-in" yes. Google/Microsoft sign-in only after the providers are configured. |
| 17 | Deadline / expiry tracking & alerts | **PARTIAL — updated 2026-09-27** | Contractor-licence and permit-expiry alerts; estimate-expiring and invoice due-soon/overdue client reminders scheduled on send/issue (`lib/reminders/quote-reminder-schedule.ts`); checklist items carry due dates with an overdue marker. No inspection or other permit-deadline alerts. | Yes for licence/permit expiry and estimate/invoice reminders; not for inspections. |
| 18 | Audit trail / activity log | **SHIPPED**, scoped | `lib/audit/log.ts:74-105` (`writeAuditLog`); real call sites at `app/(app)/projects/new/actions.ts:155-163` (project creation) and `lib/bridge/client-portal.ts:923` (document upload); DB-enforced via CHECK constraint | Yes, scoped to actions actually wired (project creation, document upload, readiness overrides) — not "every action in the app" until more call sites exist. |
| 19 | Public API access for third-party integrations | **SHIPPED, read-only, live** | `supabase/migrations/20260806000067_public_api_keys.sql` (hashed, org-scoped `org_api_keys` + append-only `api_request_log`); `lib/public-api/handler.ts` (bearer auth, 120 req/min per key, per-IP failed-auth limit, request logging); four GET endpoints under `app/api/v1/` (projects, applications, list + by id) and an OpenAPI 3.1 document at `/api/v1/openapi.json`; owner-only key management at `app/(app)/settings/api-keys/`. Gated by `PERMITFIELD_FF_PUBLIC_API` (on in Vercel Production since 2026-09-26; create/use/revoke verified end to end there) and the `api.access` entitlement (Pro/Enterprise). | Qualified — "Read-only API access to your projects and permit applications." **Not** permitted: implying write access, webhooks, or any resource beyond projects and applications. |

## Jurisdiction coverage (the only jurisdiction data in the repo — `supabase/seed.sql:14-81`)

Table below updated post-Phase-0 by the jurisdiction-expansion follow-up
(see `JURISDICTION_EXPANSION_SCOPE.md` §5b, §5c, §7d, §8, §9, §10): Surrey,
Vancouver, Richmond, Coquitlam, Port Coquitlam, and Maple Ridge, BC added
in successive passes, each with real cited research (bylaw citations,
hand-verified AcroForm field names) to the same bar Ottawa/Hamilton were
held to, not to Toronto/Calgary's direct-code-review bar. (Mississauga, ON
was researched as a candidate and re-checked in the Maple Ridge pass — it
has since moved building-permit applications to a mandatory no-PDF ePlans
portal and is disqualified, same as Burnaby/Abbotsford; it was never
seeded and is not in the table below.)

| Jurisdiction | Province | Coverage tier | Verified? |
|---|---|---|---|
| Toronto | ON | **verified** | Yes |
| Calgary | AB | **verified** | Yes |
| Ottawa | ON | **assisted** | No (never verified) |
| Hamilton | ON | **listed** | No (never verified) |
| Surrey | BC | **assisted** | No (never verified) |
| Vancouver | BC | **assisted** | No (never verified) |
| Richmond | BC | **assisted** | No (never verified) |
| Coquitlam | BC | **assisted** | No (never verified) |
| Port Coquitlam | BC | **assisted** | No (never verified) |
| Maple Ridge | BC | **assisted** | No (never verified) |

Plus one non-municipal authority attached only to the Toronto Electrical
Service Upgrade permit type: Electrical Safety Authority (ESA), Ontario,
filing mechanism `pdf_email` (`seed.sql:92-95`) — not itself a jurisdiction
row.

**8 permit types** are seeded in total (`seed.sql:182-273`): Electrical
Service Upgrade (Toronto), and Commercial Tenant Improvement in seven
jurisdictions — Calgary, Surrey, Vancouver, Richmond, Coquitlam, Port
Coquitlam, and Maple Ridge (same title, seven separate permit_type rows
and seven separate forms — not one shared row). Of those, **34 AcroForm
fields across 7 forms** are verified/mapped (`seed.sql:355-479`): 3 on
Toronto's Electrical Service Upgrade form, 5 on Surrey's Building Permit
Application, 6 on Vancouver's Development and Building Permit Application,
5 on Richmond's PL-43 form, 5 on Coquitlam's Permit Application Form, 5 on
Port Coquitlam's Tenant Improvement form, and 5 on Maple Ridge's
Tenant/Landlord Improvement Permit Application. Calgary's and ESA's forms
still have no verified field maps, and the seed file itself contains a
comment saying fabricating coordinates "would misrepresent them as
verified when they are not."

**Honest homepage phrasing:** "PermitField OS currently supports permit
filing guidance for Toronto and Calgary (fully verified), with
assisted-tier support for Ottawa, Surrey, Vancouver, Richmond, Coquitlam,
Port Coquitlam, and Maple Ridge, and listed-only support for Hamilton —
Ontario, Alberta, and British Columbia."
**Forbidden:** any claim of nationwide, all-of-Canada, or multi-province-at-scale
coverage; any claim of US coverage; any claim of coverage beyond the 10
seeded, 3-provinces-only jurisdictions in the table above.

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
- "Nationwide," "all of Canada," or any coverage claim beyond the 10 seeded, 3-provinces-only jurisdictions (see table above)
- "Get notified" / "we'll alert you" copy of any kind, **except** the two narrow, flag-gated cases in §17 (contractor-license expiry and permit expiry) — general notifications (§12) remain unbuilt, and any deadline/expiry concept beyond these two target kinds remains unbuilt within §17 itself
- "Invite your team" / role-assignment UI copy (§9 above — no such UI exists)
- Integration/API marketplace claims (§19 above)
- Any product screenshot that is not a real capture of the actual running app (§7 of `MARKETING_PHASE_0_FINDINGS.md`)

## Approved capability claims (safe to build homepage messaging around)

1. Permit application intake and status tracking, end to end (§1)
2. AI-assisted extraction of application data from uploaded documents, with human review (§2)
3. Automatic form-filling for supported forms today (Toronto Electrical Service Upgrade, and Commercial Tenant Improvement in every covered city except Calgary, which has no PDF form -- its portal answers are given ready to paste) (§3; updated 2026-10-09)
4. Organization-scoped data isolation via row-level security (§10)
5. Automated background processing for extraction, compliance audit, and PDF generation (§13)
6. Secure, organized document storage per application (§14)
7. An audit trail covering key actions (project creation, document upload, readiness overrides) (§18)
8. Coverage today in Toronto and Calgary (verified), with Ottawa, Surrey, Vancouver, Richmond, Coquitlam, Port Coquitlam, and Maple Ridge in the assisted tier and Hamilton listed-only (jurisdiction table above)
9. Email alerts before a contractor's license expires, or before a permit's (manually-entered) expiry date, arrive (§17) — narrow, and only once `PERMITFIELD_FF_DEADLINE_REMINDERS` is actually turned on in a given deployment (defaults to `false`), and (for permits) only once an expiry date has actually been entered; do not imply any broader deadline/reminder coverage exists

---

End of Phase 0. Both required deliverables (`MARKETING_PHASE_0_FINDINGS.md`
and this file) are complete. Awaiting **APPROVED: PHASE 0** before proceeding
to Phase 1 (`IMPLEMENTATION_PLAN.md` + `COPY_DECK.md`, still no code).
