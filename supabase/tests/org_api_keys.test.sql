-- Public API v1 / 20260806000067_public_api_keys.sql.
-- Proves:
--   1. Only owner/org_owner/platform_admin can create or see keys; plain
--      members and permit_managers cannot.
--   2. authenticated can never read key_hash, never edit a key, and can
--      only revoke (never un-revoke).
--   3. created_by must be the caller.
--   4. service_role can resolve a key by hash and stamp last_used_at, but
--      cannot rewrite or delete keys.
--   5. api_request_log is append-only, service_role-written, and readable
--      only by the owning org's key managers.
--   6. Tenant isolation.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated',
   'org-a-member-apikeys@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated',
   'org-a-pm-apikeys@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated',
   'org-a-orgowner-apikeys@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f2', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f3', 'org_owner')
on conflict (org_id, user_id) do nothing;

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: org A's legacy owner creates a key and can list it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_count int;
begin
  insert into org_api_keys (org_id, name, key_prefix, key_hash, created_by)
  values ('20000000-0000-0000-0000-00000000000a', 'Owner key', 'pfk_ownerkey', encode(sha256('owner-key'::bytea), 'hex'),
          '10000000-0000-0000-0000-00000000000a')
  returning id into v_id;
  insert into _test_ids (label, id) values ('key_a1', v_id);

  select count(*) into v_count from (select id, name, key_prefix from org_api_keys where id = v_id) s;
  if v_count <> 1 then
    raise exception 'FAIL: owner cannot see the key they just created';
  end if;
  raise notice 'PASS: legacy owner creates and lists an API key.';
end $$;

-- Step 2: key_hash is never readable by authenticated.
do $$
begin
  begin
    perform key_hash from org_api_keys limit 1;
    raise exception 'FAIL: authenticated could read org_api_keys.key_hash';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated cannot read key_hash (%)', sqlerrm;
  end;
end $$;

-- Step 3: no column other than revoked_at is writable.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'key_a1';
  begin
    update org_api_keys set name = 'renamed' where id = v_id;
    raise exception 'FAIL: authenticated could rename an API key';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated cannot edit key columns other than revoked_at (%)', sqlerrm;
  end;
end $$;

-- Step 4: created_by must be the caller.
do $$
begin
  begin
    insert into org_api_keys (org_id, name, key_prefix, key_hash, created_by)
    values ('20000000-0000-0000-0000-00000000000a', 'Spoofed', 'pfk_spoofed1', encode(sha256('spoofed'::bytea), 'hex'),
            '10000000-0000-0000-0000-0000000000f1');
    raise exception 'FAIL: owner inserted a key attributed to another user';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: created_by must equal auth.uid() (%)', sqlerrm;
  end;
end $$;

-- Step 5: a plain member can neither create nor see keys.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  begin
    insert into org_api_keys (org_id, name, key_prefix, key_hash, created_by)
    values ('20000000-0000-0000-0000-00000000000a', 'Member key', 'pfk_memberk1', encode(sha256('member-key'::bytea), 'hex'),
            '10000000-0000-0000-0000-0000000000f1');
    raise exception 'FAIL: plain member created an API key';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member cannot create an API key (%)', sqlerrm;
  end;

  select count(*) into v_count from (select id from org_api_keys where org_id = '20000000-0000-0000-0000-00000000000a') s;
  if v_count <> 0 then
    raise exception 'FAIL: plain member can see % org A API key(s)', v_count;
  end if;
  raise notice 'PASS: plain member sees no API keys.';
end $$;

-- Step 6: permit_manager is also outside the key-management set.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
begin
  begin
    insert into org_api_keys (org_id, name, key_prefix, key_hash, created_by)
    values ('20000000-0000-0000-0000-00000000000a', 'PM key', 'pfk_pmkey001', encode(sha256('pm-key'::bytea), 'hex'),
            '10000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL: permit_manager created an API key';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: permit_manager cannot create an API key (%)', sqlerrm;
  end;
end $$;

-- Step 7: the newer org_owner role is recognized.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f3","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into org_api_keys (org_id, name, key_prefix, key_hash, created_by)
  values ('20000000-0000-0000-0000-00000000000a', 'Org owner key', 'pfk_orgownr1', encode(sha256('org-owner-key'::bytea), 'hex'),
          '10000000-0000-0000-0000-0000000000f3')
  returning id into v_id;
  insert into _test_ids (label, id) values ('key_a2', v_id);
  raise notice 'PASS: org_owner role creates an API key.';
end $$;

-- Step 8 (tenant isolation): org B's owner cannot see or revoke org A's keys.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_count int;
begin
  select count(*) into v_count from (select id from org_api_keys where org_id = '20000000-0000-0000-0000-00000000000a') s;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner sees % org A key(s)', v_count;
  end if;

  select id into v_id from _test_ids where label = 'key_a1';
  update org_api_keys set revoked_at = now() where id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner revoked an org A key';
  end if;
  raise notice 'PASS (tenant isolation): org B owner can neither see nor revoke org A keys.';
end $$;

-- Step 9: revoke works, un-revoke does not.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_count int;
  v_revoked timestamptz;
begin
  select id into v_id from _test_ids where label = 'key_a1';

  update org_api_keys set revoked_at = now() where id = v_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'FAIL: owner could not revoke their key';
  end if;

  update org_api_keys set revoked_at = null where id = v_id;
  select revoked_at into v_revoked from org_api_keys where id = v_id;
  if v_revoked is null then
    raise exception 'FAIL: a revoked key was un-revoked';
  end if;
  raise notice 'PASS: owner revokes a key and cannot un-revoke it.';
end $$;

reset role;

-- Step 10: service_role resolves by hash and stamps last_used_at, but
-- cannot rewrite or delete keys.
set local role service_role;

do $$
declare
  v_id uuid;
  v_found uuid;
begin
  select id into v_found from org_api_keys where key_hash = encode(sha256('org-owner-key'::bytea), 'hex');
  select id into v_id from _test_ids where label = 'key_a2';
  if v_found is distinct from v_id then
    raise exception 'FAIL: service_role could not resolve a key by hash';
  end if;

  update org_api_keys set last_used_at = now() where id = v_id;
  raise notice 'PASS: service_role resolves a key by hash and stamps last_used_at.';

  begin
    update org_api_keys set org_id = '20000000-0000-0000-0000-00000000000b' where id = v_id;
    raise exception 'FAIL: service_role moved a key to another org';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: service_role cannot rewrite key columns (%)', sqlerrm;
  end;

  begin
    delete from org_api_keys where id = v_id;
    raise exception 'FAIL: service_role deleted an API key';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: service_role cannot delete API keys (%)', sqlerrm;
  end;

  insert into api_request_log (org_id, api_key_id, ip, method, path, status_code, outcome)
  values ('20000000-0000-0000-0000-00000000000a', v_id, '203.0.113.7', 'GET', '/api/v1/projects', 200, 'ok');
  insert into api_request_log (org_id, api_key_id, ip, method, path, status_code, outcome)
  values (null, null, '203.0.113.9', 'GET', '/api/v1/projects', 401, 'denied');
  raise notice 'PASS: service_role writes api_request_log rows.';

  begin
    update api_request_log set status_code = 500;
    raise exception 'FAIL: api_request_log UPDATE succeeded';
  exception
    when others then
      raise notice 'PASS: api_request_log UPDATE rejected (%)', sqlerrm;
  end;

  begin
    delete from api_request_log;
    raise exception 'FAIL: api_request_log DELETE succeeded';
  exception
    when others then
      raise notice 'PASS: api_request_log DELETE rejected (%)', sqlerrm;
  end;

  begin
    execute 'truncate api_request_log';
    raise exception 'FAIL: api_request_log TRUNCATE succeeded';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: service_role cannot TRUNCATE api_request_log (%)', sqlerrm;
  end;

  begin
    insert into api_request_log (org_id, api_key_id, method, path, status_code, outcome)
    values ('20000000-0000-0000-0000-00000000000a', null, 'GET', '/api/v1/projects', 200, 'ok');
    raise exception 'FAIL: api_request_log accepted org_id without api_key_id';
  exception
    when check_violation then
      raise notice 'PASS: api_request_log requires org_id and api_key_id together.';
  end;
end $$;

reset role;

-- Step 11: request log visibility -- key managers of the owning org only;
-- authenticated can never write it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  -- Scoped to rows this test inserted, so pre-existing local data (e.g. a
  -- developer's own API smoke tests) doesn't skew the counts.
  select count(*) into v_count from api_request_log
  where api_key_id = (select id from _test_ids where label = 'key_a2');
  if v_count <> 1 then
    raise exception 'FAIL: org A owner should see exactly its 1 log row for the test key, saw %', v_count;
  end if;

  select count(*) into v_count from api_request_log where ip = '203.0.113.9';
  if v_count <> 0 then
    raise exception 'FAIL: org A owner can see an unresolved-key (org-less) log row';
  end if;

  begin
    insert into api_request_log (org_id, api_key_id, method, path, status_code, outcome)
    values (null, null, 'GET', '/api/v1/projects', 200, 'ok');
    raise exception 'FAIL: authenticated inserted into api_request_log';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated cannot write api_request_log (%)', sqlerrm;
  end;
  raise notice 'PASS: org A owner reads only its own org''s request log (unresolved-key rows hidden).';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from api_request_log;
  if v_count <> 0 then
    raise exception 'FAIL: plain member sees % api_request_log row(s)', v_count;
  end if;
  raise notice 'PASS: plain member cannot read the API request log.';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from api_request_log;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner sees % org A log row(s)', v_count;
  end if;
  raise notice 'PASS (tenant isolation): org B owner cannot read org A''s request log.';
end $$;

reset role;

rollback;
