-- Phase 1 seed data. Two parts:
--   1. Reference data (jurisdictions, authorities, permit types/filings) --
--      real, from the Phase 0 research (see PHASE_0_FINDINGS.md SS3). Safe in
--      any environment, this is the public-record catalog the product ships.
--   2. LOCAL DEV / TEST FIXTURES ONLY -- two fake auth.users rows plus orgs,
--      so the tenant-isolation test (supabase/tests/tenant_isolation.test.sql)
--      has something real to run against. Never run part 2 against a shared
--      or production project.

-- ============================================================
-- PART 1: reference data -- now lives in
-- supabase/migrations/20260806000068_reference_catalog.sql so it reaches
-- hosted/production databases through migrations. Migrations run before
-- this file on `supabase db reset`, so the fixtures below can still
-- reference those jurisdiction/permit-type/filing ids.
-- ============================================================

-- ============================================================
-- PART 2: LOCAL DEV / TEST FIXTURES ONLY -- do not run against a shared project
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'org-a-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'org-b-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false)
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
