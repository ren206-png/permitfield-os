-- Phase 1 seed data. Two parts:
--   1. Reference data (jurisdictions, authorities, permit types/filings) --
--      real, from the Phase 0 research (see PHASE_0_FINDINGS.md SS3). Safe in
--      any environment, this is the public-record catalog the product ships.
--   2. LOCAL DEV / TEST FIXTURES ONLY -- two fake auth.users rows plus orgs,
--      so the tenant-isolation test (supabase/tests/tenant_isolation.test.sql)
--      has something real to run against. Never run part 2 against a shared
--      or production project.

-- ============================================================
-- PART 1: reference data
-- ============================================================

insert into jurisdictions (id, country, province_code, municipality, region, unit_system, portal_url, coverage_level, verified_at)
values
  ('00000000-0000-0000-0001-000000000001', 'CA', 'ON', 'Toronto', null, 'metric',
   'https://www.toronto.ca/services-payments/building-construction/apply-for-a-building-permit/',
   'verified', now()),
  ('00000000-0000-0000-0001-000000000002', 'CA', 'AB', 'Calgary', null, 'metric',
   'https://www.calgary.ca/development/permits.html',
   'verified', now()),
  ('00000000-0000-0000-0001-000000000003', 'CA', 'ON', 'Ottawa', null, 'metric',
   'https://ottawa.ca/en/permits-licences-and-parking',
   'assisted', null),
  ('00000000-0000-0000-0001-000000000004', 'CA', 'ON', 'Hamilton', null, 'metric',
   'https://www.hamilton.ca/build-invest-grow/building-permits',
   'listed', null);

-- ESA is province-wide (jurisdiction_id null), independent of any single city --
-- the concrete example SS0.6 gives for why authorities can't be nested under
-- jurisdictions.
insert into authorities (id, name, authority_level, province_code, jurisdiction_id, portal_url, filing_mechanism)
values
  ('00000000-0000-0000-0002-000000000001', 'City of Toronto - Building Division', 'municipal', 'ON',
   '00000000-0000-0000-0001-000000000001',
   'https://www.toronto.ca/services-payments/building-construction/apply-for-a-building-permit/',
   'portal'),
  ('00000000-0000-0000-0002-000000000002', 'Electrical Safety Authority (ESA)', 'agency', 'ON',
   null,
   'https://esasafe.com/fees-and-forms/forms/',
   'pdf_email'),
  ('00000000-0000-0000-0002-000000000003', 'City of Calgary - Building Permit', 'municipal', 'AB',
   '00000000-0000-0000-0001-000000000002',
   'https://www.calgary.ca/development/permits.html',
   'portal');

-- Demonstrates the multi-authority filing model end to end (SS0.6): a Toronto
-- electrical service upgrade needs a City of Toronto building permit ONLY when
-- it triggers a structural/enclosure change, and an ESA notification always --
-- two authorities, one permit type, order matters for the wizard's package output.
insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000001',
   'Electrical Service Upgrade', 'toronto/permit-to-construct-or-demolish.pdf',
   '{"requires_document_kinds": ["scope_of_work"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000002',
   'Commercial Tenant Improvement', 'calgary/commercial-building-project-application.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed');

-- Explicit ids (Phase 4) so permit_form_fields rows below can reference a
-- specific filing -- 20260806000017 re-scopes field maps from permit_type_id
-- to permit_type_filing_id (each authority's own form needs its own map).
-- form_template_path is set per filing now, not just per permit_type: it's
-- the same PDF as the permit_type's own required_form_template_path for
-- Toronto/Calgary today (one filing per permit_type there), but the whole
-- point of moving it here is Electrical Service Upgrade's ESA filing, which
-- needs a genuinely different file (docs-reference-forms/esa-icia-low-voltage.pdf,
-- a flat/non-AcroForm export -- Phase 0 finding).
insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000001', 1,
   '{"trigger": "structural_or_enclosure_change"}'::jsonb, 'toronto/permit-to-construct-or-demolish.pdf'),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000002', 2, null,
   'esa/icia-low-voltage.pdf'),
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0002-000000000003', 1, null,
   'calgary/commercial-building-project-application.pdf');

-- Field maps, from the Phase 0 pdf-lib inspection (PHASE_0_FINDINGS.md SS4):
-- Toronto's form has real AcroForm fields, so its 3 rows below use
-- pdf_field_name and were hand-verified against the actual field names
-- pdf-lib reported for docs-reference-forms/toronto-permit-application.pdf.
--
-- Deliberately NO rows here for the ESA filing (00000000-0000-0000-0004-
-- 000000000002) or Calgary (...003): ESA's ICIA-LV form has zero AcroForm
-- fields (Phase 0 finding) and would need the coordinate-overlay columns
-- instead, but overlay_x/overlay_y are real PDF pixel coordinates that must
-- come from actually measuring the rendered form -- Phase 0's research did
-- not include that measurement step, and fabricating plausible-looking
-- coordinates for a real government form here would misrepresent them as
-- verified when they are not (the same "never assert what you haven't
-- checked" discipline this system enforces on the AI audit engine, SS0.2,
-- applied to seed data). Calgary's own 15-field AcroForm was also flagged in
-- Phase 0 as needing a manual page-by-page review before its field map can
-- be trusted (it looks like a bundled multi-purpose PDF). Both are tracked
-- as a known Phase 4 limitation (see README) rather than silently faked; the
-- coordinate-overlay code path itself is still exercised, but against a
-- synthetic test-only fixture PDF with arbitrary coordinates
-- (eval/fixtures/overlay-test-form.ts), never against these real forms'
-- actual coordinates until someone has verified them by hand.
-- permit_type_id is still populated too (that column stays NOT NULL --
-- 20260806000017 added permit_type_filing_id additively without touching
-- it): both point at the same Electrical Service Upgrade permit_type here
-- since Toronto's filing hasn't diverged from it, but permit_type_filing_id
-- is what Phase 4's application code actually reads.
insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Applicant Last name', 'applicant.lastName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Applicant First name', 'applicant.firstName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Project value estimated (in dollars)', 'application.estimatedJobValueDollars', true, null, null, null);

-- ============================================================
-- PART 2: LOCAL DEV / TEST FIXTURES ONLY -- do not run against a shared project
-- ============================================================

-- Gate 2.0 sub-phase 2.6: the six trailing '' columns (confirmation_token
-- through email_change_token_current) are needed because GoTrue's Admin API
-- (auth.admin.getUserById / updateUserById) fails with a 500
-- "AuthRetryableFetchError: Database error loading user" when scanning a row
-- where these normally-nullable text columns are actually NULL -- GoTrue's
-- own signup flow always writes '' into them, and its Go-side row scanner
-- apparently isn't NULL-safe for them on read. Rows inserted directly via
-- SQL (as these always have been, since there's no real password to sign up
-- with) previously left them at their NULL default, which was silently fine
-- until sub-phase 2.6 became the first code in this repo to ever call the
-- Admin API against these two seeded owner rows (lib/bridge/
-- client-portal-admin.live.test.ts, which resets one's password via
-- updateUserById to get a session-scoped client for testing staff-facing
-- token issuance/revocation authorization). Confirmed by direct repro: both
-- getUserById and updateUserById failed identically for both rows before
-- this fix, and succeeded after backfilling these columns to '' via a
-- one-off UPDATE against a live local instance.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  phone_change, phone_change_token, email_change_token_current
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'org-a-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false,
   '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'org-b-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false,
   '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into organizations (id, name) values
  ('20000000-0000-0000-0000-00000000000a', 'Org A - Test Mechanical Ltd.'),
  ('20000000-0000-0000-0000-00000000000b', 'Org B - Test Electrical Inc.');

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner');

insert into contractors (id, org_id, company_name, primary_license_number, license_province_code) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Mechanical Ltd.', 'ON-ECRA-000001', 'ON'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Electrical Inc.', 'ON-ECRA-000002', 'ON');

-- permit_status is explicit here (Gate 1.3 review), not left to
-- permit_status_enum's column default. 'intake' is still the CORRECT value
-- for these two rows -- they mirror the pipeline `status = 'draft'` fixture
-- state, i.e. "created, nothing has happened in either machine yet" -- this
-- isn't fixing a wrong value, it's removing a silent dependency on the
-- default: if a future migration ever changes permit_status's default, an
-- implicit-default fixture row would reinterpret itself without anyone
-- touching this file, which is exactly the kind of drift an explicit value
-- prevents.
--
-- project_id (Gate 1.3 review, round 2): these two fixtures get a REAL
-- project_id below, pointing at ordinary (non-'backfill') projects created
-- in this file -- not left null for
-- 20260806000023_backfill_permit_application_project_id.sql to catch.
-- `supabase db reset` applies every migration before running this file, so
-- a row inserted here can never be seen by that migration's backfill loop
-- (it only scans rows that already exist at migration-apply time) -- an
-- orphan created here would stay an orphan forever, not get backfilled on
-- the next reset. That was harmless while project_id was nullable, but
-- once 20260806000023b (supabase/migrations_blocked/) ships and makes
-- project_id NOT NULL, a seed.sql that still inserts an orphan here would
-- make `db reset` itself fail outright. Fixing it now, while it's a
-- two-line change, avoids that becoming an emergency in an unrelated
-- future gate.
insert into projects (id, org_id, title, status) values
  ('50000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A - 200A Service Upgrade', 'draft'),
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B - 400A Service Upgrade', 'draft');

insert into permit_applications (id, org_id, project_id, contractor_id, permit_type_id, project_title, project_address, status, permit_status, estimated_job_value_cents, currency_code) values
  ('40000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0003-000000000001', 'Org A - 200A Service Upgrade', '123 Test St, Toronto, ON', 'draft', 'intake', 1250000, 'CAD'),
  ('40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0003-000000000001', 'Org B - 400A Service Upgrade', '456 Test Ave, Toronto, ON', 'draft', 'intake', 3400000, 'CAD');

-- Lifecycle & Compliance Expansion, Phase 1.1 (20260806000019): Org A/B
-- predate create_organization_with_owner()'s taxonomy-seeding extension (that
-- RPC only seeds NEW orgs going forward), so backfill the same five
-- 'project_type' rows here to keep the fixtures consistent with what a
-- freshly created org would have. `on conflict do nothing` against
-- taxonomies' `unique (org_id, kind, code)` makes this safe to re-run.
insert into taxonomies (org_id, kind, code, label, sort_order, is_seed) values
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'new_construction', 'New Construction', 1, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'renovation', 'Renovation', 2, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'addition', 'Addition', 3, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'repair', 'Repair', 4, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'demolition', 'Demolition', 5, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'new_construction', 'New Construction', 1, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'renovation', 'Renovation', 2, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'addition', 'Addition', 3, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'repair', 'Repair', 4, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'demolition', 'Demolition', 5, true)
on conflict (org_id, kind, code) do nothing;
