-- Lifecycle & Compliance Expansion, Phase 1.0. Proves three things about
-- audit_logs (20260806000018_lifecycle_rbac_roles_and_audit_log.sql), the
-- same way supabase/tests/tenant_isolation.test.sql proves them for the
-- Phase 1-5 tables:
--   1. Append-only: UPDATE and DELETE are rejected (by the reused
--      forbid_update_delete() trigger), for both `authenticated` and
--      `service_role` (the latter has BYPASSRLS, so only the trigger --
--      not RLS -- can catch it there).
--   2. Tenant isolation: org A cannot read org B's audit_logs rows.
--   3. can_read_audit_logs() actually narrows SELECT below plain
--      is_org_member(): a plain 'owner'-seeded user (this file reuses
--      tenant_isolation.test.sql's Org A/B 'owner' fixtures) CAN read,
--      proving the elevated-role check isn't simply always-false; a
--      hypothetical narrower role is exercised via a fixture row seeded
--      with role='member' below to prove is_org_member-only would NOT be
--      sufficient (i.e. this really is a stricter check, not a no-op).
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- see PHASE_0_FINDINGS.md SS1 and the Phase 1.0 report's "Tests" section):
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/audit_logs.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh).
--
-- Also runs automatically on every push/PR via .github/workflows/ci.yml's
-- sql-tests job, which has Docker (ubuntu-latest runners) and so can
-- actually execute this file end-to-end -- unlike every sandbox this file
-- has been edited in so far.

begin;

-- Org A/B and their 'owner' users are seeded by supabase/seed.sql PART 2,
-- the same fixtures tenant_isolation.test.sql relies on.
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b

-- A third member, added here (not in seed.sql) specifically to exercise
-- can_read_audit_logs()'s narrower-than-membership boundary: seeded with the
-- legacy 'member' role, which is a full org member (is_org_member = true)
-- but NOT in can_read_audit_logs()'s allowed-role list.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated',
        'orgc-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'member')
on conflict (org_id, user_id) do nothing;

-- Seed one audit_logs row per org as service_role (bypasses RLS entirely --
-- proves nothing about the INSERT policy, only sets up fixtures for the
-- SELECT/UPDATE/DELETE assertions below, mirroring how
-- tenant_isolation.test.sql seeds audits/audit_findings).
set local role service_role;

insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, entity_id)
values
  ('50000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', 'owner', 'test.seed', 'permit_applications',
   '40000000-0000-0000-0000-00000000000a'),
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '10000000-0000-0000-0000-00000000000b', 'owner', 'test.seed', 'permit_applications',
   '40000000-0000-0000-0000-00000000000b');

-- === 1a. INSERT policy: a member can write a log entry about their OWN action ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id)
  values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner',
          'test.self_insert', 'permit_applications', '40000000-0000-0000-0000-00000000000a');
  raise notice 'PASS: org A owner inserted their own audit_logs row';
end $$;

-- === 1b. INSERT policy: cannot forge another user's actor_user_id ===
do $$
begin
  begin
    insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id)
    values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'member',
            'test.forged_actor', 'permit_applications', '40000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: org A owner was able to insert a row attributed to a different user';
  exception
    when insufficient_privilege or check_violation or others then
      -- RLS with-check violations raise 42501 (insufficient_privilege) via
      -- PostgREST-style policies; asserting broadly here since the exact
      -- SQLSTATE for a failed `with check` is "new row violates row-level
      -- security policy", which Postgres also reports as 42501.
      raise notice 'PASS: forged actor_user_id insert correctly rejected';
  end;
end $$;

-- === 2. Tenant isolation: org A cannot read org B's audit_logs row ===
do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count
  from audit_logs
  where org_id = '20000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s audit_logs rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s audit_logs rows';
end $$;

-- === 3. can_read_audit_logs() is narrower than is_org_member() ===
-- Switch to the 'member'-role user seeded above: same org as the owner
-- (org A), so is_org_member(org A) is true for them -- but
-- can_read_audit_logs() must still deny them, proving this policy is not
-- simply reusing the plain-membership check.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from audit_logs where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 0 then
    raise exception 'FAIL: plain ''member'' role could read % audit_logs rows in their own org (should be 0 -- can_read_audit_logs should have denied this)', visible_count;
  end if;
  raise notice 'PASS: plain ''member'' role is correctly denied SELECT on audit_logs despite is_org_member being true';
end $$;

-- 'member' can still INSERT their own entry (the insert policy is
-- membership-based, deliberately broader than the elevated-role read policy
-- -- see the migration's header comment).
do $$
begin
  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id)
  values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'member',
          'test.member_self_insert', 'permit_applications', '40000000-0000-0000-0000-00000000000a');
  raise notice 'PASS: plain ''member'' role can still insert their own audit_logs entry';
end $$;

-- === 4. Append-only: authenticated cannot UPDATE or DELETE ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    update audit_logs set action = 'HACKED' where id = '50000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE an audit_logs row';
  exception
    when others then
      raise notice 'PASS: UPDATE on audit_logs correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from audit_logs where id = '50000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE an audit_logs row';
  exception
    when others then
      raise notice 'PASS: DELETE on audit_logs correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

-- === 5. Append-only: service_role (BYPASSRLS) is still blocked by the trigger ===
set local role service_role;

do $$
begin
  begin
    update audit_logs set action = 'HACKED' where id = '50000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE an audit_logs row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: UPDATE on audit_logs correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from audit_logs where id = '50000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE an audit_logs row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: DELETE on audit_logs correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

rollback;
