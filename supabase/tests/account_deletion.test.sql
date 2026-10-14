-- Regression guard for 20260806000090_account_deletion.sql.
-- Proves:
--   1. Only the service role can run delete_account().
--   2. A company whose only member deletes their account is deleted with
--      its append-only records, and the login is deleted.
--   3. The only owner of a shared company is refused.
--   4. A member of a shared company leaves it; the company and its records
--      stay; the login, still named by those records, is de-identified and
--      locked.
--   5. The append-only guards still refuse everyone else, even with the
--      deletion flag set by a non-postgres role.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated',
   'solo@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now(), '{"full_name":"Solo Person"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated',
   'shared-owner@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now(), '{}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated',
   'shared-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now(), '{"full_name":"Member Person"}');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
values (gen_random_uuid(), '10000000-0000-0000-0000-0000000000d3', '10000000-0000-0000-0000-0000000000d3', 'email',
        '{"sub":"10000000-0000-0000-0000-0000000000d3","email":"shared-member@test.permitfield.local"}', now(), now());

insert into organizations (id, name) values
  ('20000000-0000-0000-0000-0000000000d1', 'Solo Co'),
  ('20000000-0000-0000-0000-0000000000d2', 'Shared Co');

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'owner'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'owner'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d3', 'member');

-- Append-only rows in both companies, naming the people.
insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type)
values
  ('50000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'owner', 'test.solo', 'organizations'),
  ('50000000-0000-0000-0000-0000000000d3', '20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d3', 'member', 'test.shared', 'organizations');

-- 1. Not callable by a signed-in user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
do $$
begin
  perform delete_account('10000000-0000-0000-0000-0000000000d1');
  raise exception 'FAIL: authenticated ran delete_account()';
exception
  when insufficient_privilege then
    raise notice 'PASS: only the service role can run delete_account().';
end $$;

-- 5. The flag alone doesn't open the guards for anyone but postgres.
do $$
declare
  v_count int;
begin
  perform set_config('permitfield.account_deletion', 'on', true);
  delete from audit_logs where id = '50000000-0000-0000-0000-0000000000d1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL: authenticated deleted an append-only row with the flag set';
  end if;
  raise notice 'PASS: a signed-in user deletes nothing, flag or not.';
end $$;
reset role;

set local role service_role;
do $$
begin
  perform set_config('permitfield.account_deletion', 'on', true);
  delete from audit_logs where id = '50000000-0000-0000-0000-0000000000d1';
  raise exception 'FAIL: the service role deleted an append-only row by setting the flag';
exception
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: the service role cannot delete append-only rows, even with the flag set.';
end $$;
do $$
begin
  perform set_config('permitfield.account_deletion', '', true);
end $$;

-- 3. The only owner of a shared company is refused.
do $$
begin
  perform delete_account('10000000-0000-0000-0000-0000000000d2');
  raise exception 'FAIL: the only owner of a shared company deleted their account';
exception
  when others then
    if sqlerrm not like 'sole_owner%' then raise; end if;
    raise notice 'PASS: the only owner of a shared company must hand over ownership first.';
end $$;

-- 2 and 4 run delete_account() as the service role (as the server action
-- does); the results are checked afterwards as postgres, which can read auth.users.
create temporary table deletion_results (who text primary key, result jsonb);
grant all on deletion_results to service_role;

do $$
begin
  insert into deletion_results values ('solo', delete_account('10000000-0000-0000-0000-0000000000d1'));
  insert into deletion_results values ('member', delete_account('10000000-0000-0000-0000-0000000000d3'));
end $$;

reset role;

-- 2. Solo company: deleted with its records; the login is deleted.
do $$
begin
  if exists (select 1 from organizations where id = '20000000-0000-0000-0000-0000000000d1') then
    raise exception 'FAIL: the solo company still exists';
  end if;
  if exists (select 1 from audit_logs where id = '50000000-0000-0000-0000-0000000000d1') then
    raise exception 'FAIL: the solo company''s append-only records still exist';
  end if;
  if exists (select 1 from auth.users where id = '10000000-0000-0000-0000-0000000000d1') then
    raise exception 'FAIL: the solo login still exists';
  end if;
  if (select (result ->> 'deidentified')::boolean from deletion_results where who = 'solo') then
    raise exception 'FAIL: expected a full delete, got de-identification';
  end if;
  raise notice 'PASS: a solo company and its records are deleted, and so is the login.';
end $$;

-- 4. Shared company member: leaves; records stay; login de-identified.
do $$
declare
  v_user auth.users%rowtype;
begin
  if not exists (select 1 from organizations where id = '20000000-0000-0000-0000-0000000000d2') then
    raise exception 'FAIL: the shared company was deleted';
  end if;
  if exists (select 1 from org_members where user_id = '10000000-0000-0000-0000-0000000000d3') then
    raise exception 'FAIL: the member is still in the shared company';
  end if;
  if not exists (select 1 from audit_logs where id = '50000000-0000-0000-0000-0000000000d3') then
    raise exception 'FAIL: the shared company lost its records';
  end if;
  select * into v_user from auth.users where id = '10000000-0000-0000-0000-0000000000d3';
  if v_user.email not like 'deleted-%@deleted.permitfieldos.invalid'
     or v_user.raw_user_meta_data <> '{}'::jsonb
     or v_user.encrypted_password <> ''
     or v_user.banned_until <> 'infinity'::timestamptz then
    raise exception 'FAIL: the login was not de-identified and locked: %', v_user.email;
  end if;
  if exists (select 1 from auth.identities where user_id = '10000000-0000-0000-0000-0000000000d3') then
    raise exception 'FAIL: linked identities were kept';
  end if;
  if not (select (result ->> 'deidentified')::boolean from deletion_results where who = 'member') then
    raise exception 'FAIL: expected de-identification';
  end if;
  raise notice 'PASS: a shared-company member leaves; the company keeps its records; the login is de-identified and locked.';
end $$;

rollback;
