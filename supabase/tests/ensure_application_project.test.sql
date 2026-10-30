-- ensure_application_project (20260806000102):
--   1. A member of the application's org gets a project created, named after
--      the application, marked source = 'application', and linked.
--   2. Calling again returns the same project and creates nothing.
--   3. An application that already has a project keeps it.
--   4. Another org's member gets no_data_found and nothing is created.
--   5. anon cannot execute it.
--
-- Control-then-assert; expected failures are caught by SQLSTATE.
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres): an org A application with no project ===
insert into permit_applications (id, org_id, contractor_id, permit_type_id, project_title, project_address)
select 'e2000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
       permit_type_id, 'Ensure-project fixture', '1 Fixture Street'
from permit_applications where id = '40000000-0000-0000-0000-00000000000a';

do $$
begin
  if (select project_id from permit_applications where id = 'e2000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FAIL: fixture setup: the application should start without a project';
  end if;
end $$;

-- === 1 + 2 + 3. Org A owner ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare v1 uuid; v2 uuid; v_seed uuid; n int;
begin
  v1 := ensure_application_project('e2000000-0000-0000-0000-000000000001');
  if v1 is null
     or (select project_id from permit_applications where id = 'e2000000-0000-0000-0000-000000000001') is distinct from v1
     or not exists (select 1 from projects where id = v1 and org_id = '20000000-0000-0000-0000-00000000000a'
                    and title = 'Ensure-project fixture' and source = 'application' and status = 'draft') then
    raise exception 'FAIL: a project should be created, named after the application, and linked';
  end if;
  raise notice 'PASS: a member gets a project created and linked';

  select count(*) into n from projects where org_id = '20000000-0000-0000-0000-00000000000a';
  v2 := ensure_application_project('e2000000-0000-0000-0000-000000000001');
  if v2 <> v1 or (select count(*) from projects where org_id = '20000000-0000-0000-0000-00000000000a') <> n then
    raise exception 'FAIL: a second call should return the same project and create nothing';
  end if;
  raise notice 'PASS: a second call returns the same project and creates nothing';

  v_seed := ensure_application_project('40000000-0000-0000-0000-00000000000a');
  if v_seed <> '50000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: an application with a project should keep it (got %)', v_seed;
  end if;
  raise notice 'PASS: an existing project is kept';
end $$;

-- === 4. Org B owner, on an org A application ===
reset role;
insert into permit_applications (id, org_id, contractor_id, permit_type_id, project_title, project_address)
select 'e2000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
       permit_type_id, 'Ensure-project cross-org fixture', '2 Fixture Street'
from permit_applications where id = '40000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
begin
  begin
    perform ensure_application_project('e2000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: another org''s member linked a project to org A''s application';
  exception when no_data_found then
    raise notice 'PASS: another org''s member gets no_data_found';
  end;
end $$;

reset role;
do $$
begin
  if (select project_id from permit_applications where id = 'e2000000-0000-0000-0000-000000000002') is not null
     or exists (select 1 from projects where title = 'Ensure-project cross-org fixture') then
    raise exception 'FAIL: the refused call must not create or link a project';
  end if;
  raise notice 'PASS: the refused call created and linked nothing';
end $$;

-- === 5. anon ===
set local role anon;
do $$
begin
  begin
    perform ensure_application_project('e2000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: anon executed ensure_application_project';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot execute ensure_application_project';
  end;
end $$;

rollback;
