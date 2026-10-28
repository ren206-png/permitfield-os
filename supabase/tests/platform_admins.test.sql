-- Gate 6, finding F4: proves platform_admins
-- (20260806000095_platform_admins.sql) behaves as designed:
--   1. An account listed in platform_admins is a platform admin without any
--      org role, and can then do a catalogue write (control first: the same
--      account, unlisted, cannot).
--   2. The existing org-role path still works.
--   3. Nobody can read or write platform_admins through the API, so an
--      account cannot list or promote itself.
--   4. The function's grants are unchanged: authenticated may execute it,
--      anon may not.
--
-- Expected failures are caught by SQLSTATE, never `when others`.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f4', 'authenticated', 'authenticated',
   'staff-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
   'platform-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

-- The staff account owns its own org, like a real founder account.
insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f4', 'owner'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000d', 'platform_admin')
on conflict (org_id, user_id) do nothing;

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url)
values ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'forms_page', 'https://example.test/f4');

-- === 1. Unlisted owner: not an admin (control) ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
do $$
begin
  if is_platform_admin() then raise exception 'FAIL: an unlisted owner is a platform admin'; end if;
  insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
  values ('f4000000-0000-0000-0000-000000000001', 1, repeat('a', 64), 'F4', 'City', now(), 'public', auth.uid());
  raise exception 'FAIL: an unlisted owner wrote to the catalogue';
exception when insufficient_privilege then
  raise notice 'PASS: control: an unlisted org owner is not a platform admin and cannot write the catalogue';
end $$;

-- === 3. No self-promotion, no listing ===
do $$
begin
  insert into platform_admins (user_id) values (auth.uid());
  raise exception 'FAIL: an account added itself to platform_admins';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated cannot insert into platform_admins';
end $$;

do $$
declare n int;
begin
  select count(*) into n from platform_admins;
  raise exception 'FAIL: authenticated can read platform_admins';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated cannot read platform_admins';
end $$;

reset role;
set local role service_role;
do $$
begin
  insert into platform_admins (user_id) values ('10000000-0000-0000-0000-0000000000f4');
  raise exception 'FAIL: service_role inserted into platform_admins';
exception when insufficient_privilege then
  raise notice 'PASS: service_role cannot insert into platform_admins either';
end $$;

-- === 1 (cont.). Listed by the owner (postgres): now an admin, org role unchanged ===
reset role;
insert into platform_admins (user_id, note) values ('10000000-0000-0000-0000-0000000000f4', 'F4 test');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
do $$
begin
  if not is_platform_admin() then raise exception 'FAIL: a listed account is not a platform admin'; end if;
  insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
  values ('f4000000-0000-0000-0000-000000000001', 1, repeat('b', 64), 'F4', 'City', now(), 'public', auth.uid());
  if not exists (select 1 from org_members where user_id = auth.uid() and role = 'owner') then
    raise exception 'FAIL: the account lost its owner role';
  end if;
  raise notice 'PASS: a listed account is a platform admin, can write the catalogue, and is still its org''s owner';
end $$;

-- === 2. The org-role path still works ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
begin
  if not is_platform_admin() then raise exception 'FAIL: the org-role platform admin lost access'; end if;
  raise notice 'PASS: an org_members platform_admin is still a platform admin';
end $$;

-- === 4. Grants unchanged ===
reset role;
do $$
begin
  if has_function_privilege('anon', 'is_platform_admin()', 'execute') then
    raise exception 'FAIL: anon can execute is_platform_admin()';
  end if;
  if not has_function_privilege('authenticated', 'is_platform_admin()', 'execute') then
    raise exception 'FAIL: authenticated lost execute on is_platform_admin()';
  end if;
  raise notice 'PASS: is_platform_admin() grants unchanged (authenticated yes, anon no)';
end $$;

rollback;
