-- Gate 4 (Quotes & Payments), Phase A / 20260806000051_org_tax_profiles.sql.
-- Proves: (1) tenant isolation, (2) write access is billing-manager tier
-- (org_owner/permit_manager), stricter than read (any member), exercised
-- via a real 'member'-role fixture -- same discipline as
-- lifecycle_intake.test.sql proving taxonomies' owner-only write boundary.
--
-- Org A/B and their owners are seeded by supabase/seed.sql PART 2.
-- HOW TO RUN: npm run test:sql (or see tenant_isolation.test.sql's header
-- for the full supabase start / db reset / psql invocation).

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
--
-- A plain 'member' and a 'permit_manager' fixture in org A, to exercise
-- is_org_billing_manager()'s tier boundary.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated',
   'org-a-member-tax@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated',
   'org-a-permit-manager-tax@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

-- Step 1: org A owner creates org A's tax profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  insert into org_tax_profiles (org_id, legal_name, address_line1, city, province_code, postal_code)
  values ('20000000-0000-0000-0000-00000000000a', 'Org A Test Mechanical Ltd.', '123 Test St', 'Toronto', 'ON', 'M5V 2T6');
  raise notice 'PASS: org owner can insert their own org''s tax profile.';
end $$;

-- Step 2 (RLS positive): a plain member of org A can read it.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from org_tax_profiles where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL (RLS positive): plain member should see org A''s own tax profile, saw %', v_count;
  end if;
  raise notice 'PASS (RLS positive): plain member reads org A''s tax profile.';
end $$;

-- Step 3 (RLS negative, tenant isolation): org B's owner cannot read org A's row.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from org_tax_profiles where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (RLS negative): org B owner could read org A''s tax profile';
  end if;
  raise notice 'PASS (RLS negative): org B owner cannot read org A''s tax profile.';
end $$;

-- Step 4 (privilege boundary, negative): a plain member of org A cannot
-- UPDATE org A's own tax profile. is_org_billing_manager() excludes the
-- 'member' role from the UPDATE policy's USING clause, not just its WITH
-- CHECK -- so the row is filtered out BEFORE the update ever runs, making
-- this a silent 0-row no-op, not a catchable exception (the same
-- RLS-conditional-no-op pattern estimates.test.sql's Step 6 documents:
-- USING excludes the row from the update set entirely, WITH CHECK never
-- gets a chance to fire). Asserted via row-count + unchanged value, not
-- exception-catching.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_name text;
begin
  update org_tax_profiles set legal_name = 'Hijacked Name' where org_id = '20000000-0000-0000-0000-00000000000a';
  if found then
    raise exception 'FAIL: plain member''s UPDATE of org A''s tax profile affected a row -- billing-manager tier should be required';
  end if;

  select legal_name into v_name from org_tax_profiles where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_name = 'Hijacked Name' then
    raise exception 'FAIL: plain member''s UPDATE of org A''s tax profile persisted despite affecting 0 rows';
  end if;
  raise notice 'PASS: plain member''s UPDATE of org A''s tax profile is a silent no-op (0 rows affected, legal_name unchanged: %)', v_name;
end $$;

-- Step 5 (privilege boundary, positive): a permit_manager of org A CAN update it.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
declare
  v_name text;
begin
  update org_tax_profiles set legal_name = 'Org A Renamed Ltd.', gst_hst_status = 'registered', gst_hst_number = '123456789RT0001'
  where org_id = '20000000-0000-0000-0000-00000000000a';

  select legal_name into v_name from org_tax_profiles where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_name <> 'Org A Renamed Ltd.' then
    raise exception 'FAIL: permit_manager UPDATE of org A''s tax profile did not persist (legal_name=%)', v_name;
  end if;
  raise notice 'PASS: permit_manager can update org A''s tax profile (legal_name=%)', v_name;
end $$;

-- Step 6 (CHECK constraint): 'registered' status without a number is rejected.
do $$
begin
  begin
    update org_tax_profiles set bc_pst_status = 'registered', bc_pst_number = null
    where org_id = '20000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: bc_pst_status = registered with a null bc_pst_number was accepted';
  exception
    when check_violation then
      raise notice 'PASS: registered status without a number is rejected by the CHECK constraint (%)', sqlerrm;
  end;
end $$;

-- Step 7: GST/HST and BC PST are tracked independently -- setting one
-- never implicitly changes the other.
do $$
declare
  v_gst tax_registration_status;
  v_pst tax_registration_status;
begin
  update org_tax_profiles set bc_pst_status = 'registered', bc_pst_number = 'PST-1234-5678'
  where org_id = '20000000-0000-0000-0000-00000000000a';

  select gst_hst_status, bc_pst_status into v_gst, v_pst from org_tax_profiles where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_gst <> 'registered' or v_pst <> 'registered' then
    raise exception 'FAIL: expected both gst_hst_status and bc_pst_status registered independently, got gst=%, pst=%', v_gst, v_pst;
  end if;
  raise notice 'PASS: gst_hst_status (%) and bc_pst_status (%) are tracked as independent columns.', v_gst, v_pst;
end $$;

reset role;

rollback;
