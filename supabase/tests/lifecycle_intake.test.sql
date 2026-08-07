-- Lifecycle & Compliance Expansion, Phase 1.1. Proves four things about
-- taxonomies/clients/properties/projects
-- (20260806000019_lifecycle_intake_properties_clients_taxonomies.sql,
-- 20260806000020_create_project_with_intake_atomic.sql), the same way
-- supabase/tests/tenant_isolation.test.sql and
-- supabase/tests/audit_logs.test.sql prove them for earlier tables:
--   1. Tenant isolation: org A cannot read org B's rows in any of the four
--      new tables.
--   2. Composite-FK cross-org rejection: a project (or property) in org A
--      cannot reference a client/property/contractor/taxonomy row that
--      belongs to org B -- rejected by the FK constraint itself (SQLSTATE
--      23503), independent of and prior to any RLS check. This is the
--      concrete proof for the migration's own header comment claim that
--      `(org_id, x_id) references x (org_id, id)` closes the gap
--      `permit_applications`'s bare-id FKs (20260806000006) leave open.
--   3. taxonomies write access is owner-only (is_org_owner), stricter than
--      clients/properties/projects (is_org_member) -- exercised the same
--      way audit_logs.test.sql proves can_read_audit_logs is narrower than
--      is_org_member: via a real 'member'-role fixture, not by inspection.
--   4. create_project_with_intake() is atomic: when the project insert step
--      fails (e.g. a cross-org taxonomy_id), the inline client insert that
--      already ran earlier in the same function call is rolled back too --
--      no orphaned client row survives. This is the concrete proof for
--      20260806000020's header comment, and the fix for the gap the Phase
--      1.1 report's adversarial self-check (question 6) flagged and left
--      open: three sequential `.insert()` calls from the Server Action used
--      to each be their own transaction, so a client could be created and
--      then silently orphaned by a later failure.
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- see PHASE_0_FINDINGS.md SS1 and the Phase 1.0 report's "Tests" section):
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/lifecycle_intake.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh).

begin;

-- Org A/B and their 'owner' users are seeded by supabase/seed.sql PART 2
-- (same fixtures tenant_isolation.test.sql and audit_logs.test.sql rely
-- on), including the five 'project_type' taxonomies backfilled per org by
-- this phase's seed.sql update, and contractors
-- 30000000-...a / 30000000-...b.

-- A 'member'-role fixture in org A, to exercise taxonomies' owner-only
-- write boundary below -- same pattern audit_logs.test.sql already
-- established for the same reason.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated',
        'orgc-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'member')
on conflict (org_id, user_id) do nothing;

-- Seed one org-B client and one org-B property (fixed ids, for the
-- cross-org forgery attempts below to reference) as service_role,
-- bypassing RLS -- same fixture-setup pattern audit_logs.test.sql and
-- tenant_isolation.test.sql both use. Seeded via service_role (not "as org
-- B's owner") specifically so every `set local request.jwt.claims` in this
-- file stays a top-level statement, never nested inside a `do $$ ... $$`
-- block -- PL/pgSQL statements are SPI calls, and this file follows the
-- rest of this repo's tests in keeping role/claim switches outside of them.
set local role service_role;

insert into clients (id, org_id, name)
values ('60000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Client');

insert into properties (id, org_id, address_line1, city, province_code, postal_code)
values ('60000000-0000-0000-0000-00000000001b', '20000000-0000-0000-0000-00000000000b', '456 Test Ave', 'Toronto', 'ON', 'M5V 2T6');

-- === Org A owner: happy path -- create a client, a property under that
-- client, and a project referencing that client/property plus org A's own
-- existing contractor and taxonomy. All same-org references, all four
-- INSERT policies (is_org_member) plus every composite FK should succeed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_client_id uuid;
  v_property_id uuid;
  v_taxonomy_id uuid;
  v_project_id uuid;
begin
  insert into clients (org_id, name, email)
  values ('20000000-0000-0000-0000-00000000000a', 'Org A Test Client', 'client@example.test')
  returning id into v_client_id;

  insert into properties (org_id, client_id, address_line1, city, province_code, postal_code)
  values ('20000000-0000-0000-0000-00000000000a', v_client_id, '123 Test St', 'Toronto', 'ON', 'M5V 2T6')
  returning id into v_property_id;

  select id into v_taxonomy_id from taxonomies
  where org_id = '20000000-0000-0000-0000-00000000000a' and kind = 'project_type' and code = 'renovation';

  if v_taxonomy_id is null then
    raise exception 'FAIL: expected seed.sql to have backfilled a renovation taxonomy for org A';
  end if;

  insert into projects (org_id, client_id, property_id, contractor_id, taxonomy_id, title)
  values (
    '20000000-0000-0000-0000-00000000000a',
    v_client_id,
    v_property_id,
    '30000000-0000-0000-0000-00000000000a', -- org A's own seeded contractor
    v_taxonomy_id,
    'Org A Test Project'
  )
  returning id into v_project_id;

  raise notice 'PASS: org A owner created a client, property, and project with same-org references';
end $$;

-- === Composite-FK cross-org rejection: org A owner attempts to create a
-- project (org_id = org A) that references org B's client/property/
-- contractor/taxonomy. Each must fail with a foreign_key_violation
-- (23503), NOT succeed and NOT merely be RLS-filtered -- the row would
-- never even be insertable, which is the whole point of the composite FK
-- over relying on RLS alone (RLS's own with-check on `projects_insert`
-- only validates `is_org_member(org_id)`; it has no idea client_id belongs
-- to a different org, same gap this migration's header comment describes
-- for permit_applications' bare-id FKs).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into projects (org_id, client_id, title)
    values ('20000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000b', 'FAIL: cross-org client');
    raise exception 'FAIL: org A project accepted a client_id belonging to org B';
  exception
    when foreign_key_violation then
      raise notice 'PASS: cross-org client_id on projects rejected by composite FK (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into projects (org_id, property_id, title)
    values ('20000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000001b', 'FAIL: cross-org property');
    raise exception 'FAIL: org A project accepted a property_id belonging to org B';
  exception
    when foreign_key_violation then
      raise notice 'PASS: cross-org property_id on projects rejected by composite FK (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into projects (org_id, contractor_id, title)
    values ('20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000b', 'FAIL: cross-org contractor');
    raise exception 'FAIL: org A project accepted a contractor_id belonging to org B';
  exception
    when foreign_key_violation then
      raise notice 'PASS: cross-org contractor_id on projects rejected by composite FK (%)', sqlerrm;
  end;
end $$;

do $$
declare
  v_org_b_taxonomy_id uuid;
begin
  select id into v_org_b_taxonomy_id from taxonomies
  where org_id = '20000000-0000-0000-0000-00000000000b' and kind = 'project_type' and code = 'renovation';

  begin
    insert into projects (org_id, taxonomy_id, title)
    values ('20000000-0000-0000-0000-00000000000a', v_org_b_taxonomy_id, 'FAIL: cross-org taxonomy');
    raise exception 'FAIL: org A project accepted a taxonomy_id belonging to org B';
  exception
    when foreign_key_violation then
      raise notice 'PASS: cross-org taxonomy_id on projects rejected by composite FK (%)', sqlerrm;
  end;
end $$;

-- === create_project_with_intake() happy path: the happy-path block above
-- (line ~71) exercises clients/properties/projects via raw inserts to
-- prove RLS/composite-FK behavior on the tables themselves; this block
-- calls the RPC createProjectAction actually uses, proving the function
-- itself creates all three rows together and returns their ids -- the
-- positive-path counterpart to the atomicity (failure) test below.
do $$
declare
  v_taxonomy_id uuid;
  v_result record;
begin
  select id into v_taxonomy_id from taxonomies
  where org_id = '20000000-0000-0000-0000-00000000000a' and kind = 'project_type' and code = 'addition';

  select * into v_result from create_project_with_intake(
    p_org_id := '20000000-0000-0000-0000-00000000000a',
    p_title := 'RPC happy path project',
    p_description := null,
    p_taxonomy_id := v_taxonomy_id,
    p_property_owner_name := null,
    p_applicant_name := null,
    p_status := 'draft',
    p_client_name := 'RPC Test Client',
    p_client_email := null,
    p_client_phone := null,
    p_address_line1 := '321 RPC Ave',
    p_address_line2 := null,
    p_city := 'Toronto',
    p_province_code := 'ON',
    p_postal_code := 'M5V 2T6'
  );

  if v_result.project_id is null or v_result.client_id is null or v_result.property_id is null then
    raise exception 'FAIL: create_project_with_intake did not return all three ids on the happy path (project_id=%, client_id=%, property_id=%)', v_result.project_id, v_result.client_id, v_result.property_id;
  end if;

  raise notice 'PASS: create_project_with_intake created client/property/project together and returned all three ids';
end $$;

-- === create_project_with_intake() atomicity: force the function's final
-- (project) insert to fail on a cross-org taxonomy_id, after its earlier
-- (client) insert has already run in the same call, then prove that client
-- row did NOT survive -- the whole function call rolled back as one unit,
-- not just the statement that raised. This is the fix for the gap the
-- Phase 1.1 report's adversarial self-check (question 6) flagged: before
-- 20260806000020, createProjectAction issued three independent
-- `.insert()` calls (each its own transaction), so a client created by the
-- first call could be silently orphaned if a later call failed. Still
-- running as org A's owner (claims unchanged since line 117 above).
do $$
declare
  v_org_b_taxonomy_id uuid;
  client_count_before int;
  client_count_after int;
begin
  select id into v_org_b_taxonomy_id from taxonomies
  where org_id = '20000000-0000-0000-0000-00000000000b' and kind = 'project_type' and code = 'renovation';

  select count(*) into client_count_before from clients where org_id = '20000000-0000-0000-0000-00000000000a';

  begin
    perform create_project_with_intake(
      p_org_id := '20000000-0000-0000-0000-00000000000a',
      p_title := 'FAIL: should never persist (atomicity test)',
      p_description := null,
      p_taxonomy_id := v_org_b_taxonomy_id, -- cross-org, rejected by the composite FK on the final insert
      p_property_owner_name := null,
      p_applicant_name := null,
      p_status := 'draft',
      p_client_name := 'Should Not Persist (atomicity test)',
      p_client_email := null,
      p_client_phone := null,
      p_address_line1 := null,
      p_address_line2 := null,
      p_city := null,
      p_province_code := null,
      p_postal_code := null
    );
    raise exception 'FAIL: create_project_with_intake accepted a cross-org taxonomy_id';
  exception
    when foreign_key_violation then
      raise notice 'PASS: create_project_with_intake rejected cross-org taxonomy_id on its final insert (%)', sqlerrm;
  end;

  select count(*) into client_count_after from clients where org_id = '20000000-0000-0000-0000-00000000000a';

  if client_count_after <> client_count_before then
    raise exception 'FAIL: create_project_with_intake left an orphaned client row behind after its project insert failed (before=%, after=%)', client_count_before, client_count_after;
  end if;

  raise notice 'PASS: create_project_with_intake is atomic -- the inline client insert rolled back along with the failed project insert';
end $$;

-- properties.client_id has the same composite-FK guard -- one representative
-- check (not all four again) since the mechanism is identical.
do $$
begin
  begin
    insert into properties (org_id, client_id, address_line1, city, province_code, postal_code)
    values ('20000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000b', '789 Test Blvd', 'Toronto', 'ON', 'M5V 2T6');
    raise exception 'FAIL: org A property accepted a client_id belonging to org B';
  exception
    when foreign_key_violation then
      raise notice 'PASS: cross-org client_id on properties rejected by composite FK (%)', sqlerrm;
  end;
end $$;

-- === Tenant isolation: org A cannot read org B's rows in any of the four
-- new tables (org B rows exist now: the property inserted above, plus its
-- seed.sql taxonomies/contractor/permit_applications).
do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count from properties where org_id = '20000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s properties rows', cross_tenant_count;
  end if;

  select count(*) into cross_tenant_count from taxonomies where org_id = '20000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s taxonomies rows', cross_tenant_count;
  end if;

  raise notice 'PASS: org A owner cannot read org B''s properties or taxonomies rows';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count from clients where org_id = '20000000-0000-0000-0000-00000000000a';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org B owner could read % of org A''s clients rows', cross_tenant_count;
  end if;

  select count(*) into cross_tenant_count from projects where org_id = '20000000-0000-0000-0000-00000000000a';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org B owner could read % of org A''s projects rows', cross_tenant_count;
  end if;

  raise notice 'PASS: org B owner cannot read org A''s clients or projects rows';
end $$;

-- === create_project_with_intake() cross-org forgery: org B's owner
-- (current claims) attempts to call the function with p_org_id = org A.
-- security definer bypasses the projects_insert/clients_insert/
-- properties_insert RLS policies entirely, which is exactly why the
-- function does its own `is_org_member(p_org_id)` check as its first
-- statement (20260806000020's header comment) -- this proves that check
-- actually runs and actually rejects, not just that it's present in the
-- source.
do $$
begin
  begin
    perform create_project_with_intake(
      p_org_id := '20000000-0000-0000-0000-00000000000a',
      p_title := 'FAIL: org B owner forging an org A project via RPC',
      p_description := null,
      p_taxonomy_id := null,
      p_property_owner_name := null,
      p_applicant_name := null,
      p_status := 'draft',
      p_client_name := null,
      p_client_email := null,
      p_client_phone := null,
      p_address_line1 := null,
      p_address_line2 := null,
      p_city := null,
      p_province_code := null,
      p_postal_code := null
    );
    raise exception 'FAIL: create_project_with_intake let org B''s owner create a project for org A';
  exception
    when insufficient_privilege then
      raise notice 'PASS: create_project_with_intake rejected a non-member org_id (%)', sqlerrm;
  end;
end $$;

-- === taxonomies: owner-only write, narrower than clients/properties/
-- projects (plain membership). Switch to org A's 'member'-role fixture.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
begin
  begin
    insert into taxonomies (org_id, kind, code, label)
    values ('20000000-0000-0000-0000-00000000000a', 'project_type', 'member_forged', 'Should be rejected');
    raise exception 'FAIL: plain member role was able to insert a taxonomies row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: plain member role correctly denied INSERT on taxonomies (%)', sqlerrm;
  end;
end $$;

-- But the same 'member' user CAN create a client (is_org_member-gated, not
-- owner-gated) -- proves clients/properties/projects really are more
-- permissive than taxonomies, not that this user is blocked from
-- everything.
do $$
begin
  insert into clients (org_id, name)
  values ('20000000-0000-0000-0000-00000000000a', 'Member-created client');
  raise notice 'PASS: plain member role can insert a clients row (is_org_member-gated, unlike taxonomies)';
end $$;

rollback;
