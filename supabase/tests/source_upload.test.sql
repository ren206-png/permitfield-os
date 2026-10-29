-- Source registry uploads (20260806000100_source_upload.sql):
--   1. Only a platform admin can call record_source_upload; a member and
--      anon are refused, and nothing is written.
--   2. An admin's upload stages a capture, recorded as 'uploaded' with the
--      file name and the admin as the requester; the same text again is
--      'unchanged' and stages nothing new.
--   3. The upload counts as a successful check (source_check_status).
--   4. The shape constraint: an uploaded run needs a file name and a
--      requester; a fetched run cannot carry a file name.
--   5. The capture publishes through the normal publish_source_revision.
--   6. Archived sources are refused.
--
-- Control-then-assert throughout; expected failures are caught by SQLSTATE.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'upload-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'upload-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'platform_admin'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'member')
on conflict (org_id, user_id) do nothing;

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, archived_at) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000006', 'fee_schedule', 'https://example.test/upload/fees', null),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000006', 'fee_schedule', 'https://example.test/upload/archived', now());

create or replace function pg_temp.capture(p_text text) returns jsonb language sql as $$
  select jsonb_build_object(
    'content_sha256', encode(sha256(convert_to(p_text, 'UTF8')), 'hex'),
    'loader', 'pdf', 'loader_version', 'test',
    'text', p_text,
    'chunks', jsonb_build_array(jsonb_build_object('index', 0, 'locator', 'Page 1', 'content', p_text)));
$$;

create temporary table upload_ids (name text primary key, id uuid) on commit drop;
grant all on upload_ids to authenticated;

-- === 1. A member and anon are refused ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
do $$
begin
  begin
    perform record_source_upload('e1000000-0000-0000-0000-000000000001', 'fees.pdf', 'application/pdf', 100,
      pg_temp.capture('Building permit: first $5,000, $217.00.'));
    raise exception 'FAIL: a member uploaded a source copy';
  exception when insufficient_privilege then
    raise notice 'PASS: a member cannot upload (insufficient_privilege)';
  end;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform record_source_upload('e1000000-0000-0000-0000-000000000001', 'fees.pdf', 'application/pdf', 100,
      pg_temp.capture('Building permit: first $5,000, $217.00.'));
    raise exception 'FAIL: anon uploaded a source copy';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot execute record_source_upload';
  end;
end $$;

reset role;
do $$
begin
  if exists (select 1 from source_check_runs where source_id = 'e1000000-0000-0000-0000-000000000001')
     or exists (select 1 from source_captures where source_id = 'e1000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: a refused upload wrote something';
  end if;
  raise notice 'PASS: refused uploads wrote nothing';
end $$;

-- === 2. The admin uploads; the same text again is unchanged ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare r record; r2 record; run source_check_runs%rowtype; n int;
begin
  select * into r from record_source_upload('e1000000-0000-0000-0000-000000000001', 'fees-2026.pdf', 'application/pdf', 1234,
    pg_temp.capture('Building permit: first $5,000, $217.00.'));
  if r.outcome <> 'changed' or r.capture_id is null then
    raise exception 'FAIL: first upload should stage a capture (outcome %)', r.outcome;
  end if;
  insert into upload_ids values ('capture', r.capture_id);

  select * into run from source_check_runs where id = r.check_run_id;
  if run.method <> 'uploaded' or run.uploaded_file_name <> 'fees-2026.pdf' or run.requested_by <> auth.uid()
     or run.byte_length <> 1234 or run.http_status is not null or run.capture_id <> r.capture_id then
    raise exception 'FAIL: upload run recorded wrongly (%)', row_to_json(run);
  end if;
  raise notice 'PASS: an admin upload stages a capture, recorded as uploaded by auth.uid() with the file name';

  select * into r2 from record_source_upload('e1000000-0000-0000-0000-000000000001', 'fees-2026 (1).pdf', 'application/pdf', 1234,
    pg_temp.capture('Building permit: first $5,000, $217.00.'));
  select count(*) into n from source_captures where source_id = 'e1000000-0000-0000-0000-000000000001';
  if r2.outcome <> 'unchanged' or n <> 1 then
    raise exception 'FAIL: identical upload should be unchanged with one capture (outcome %, captures %)', r2.outcome, n;
  end if;
  raise notice 'PASS: the same text uploaded again is unchanged and stages nothing new';

  -- === 3. Freshness ===
  if (select last_success_at from source_check_status() where source_id = 'e1000000-0000-0000-0000-000000000001') is null then
    raise exception 'FAIL: an upload should count as a successful check';
  end if;
  raise notice 'PASS: an upload counts as a successful check for freshness';

  -- === 6. Archived source ===
  begin
    perform record_source_upload('e1000000-0000-0000-0000-000000000002', 'old.pdf', 'application/pdf', 10, pg_temp.capture('Old.'));
    raise exception 'FAIL: uploaded to an archived source';
  exception when no_data_found then
    raise notice 'PASS: an archived source refuses uploads (no_data_found)';
  end;
end $$;

-- === 4. Shape constraint (as postgres, bypassing the function) ===
reset role;
do $$
begin
  begin
    insert into source_check_runs (source_id, idempotency_key, outcome, method, uploaded_file_name, requested_by)
    values ('e1000000-0000-0000-0000-000000000001', 'shape-1', 'unchanged', 'uploaded', null, '10000000-0000-0000-0000-0000000000e1');
    raise exception 'FAIL: an uploaded run without a file name was accepted';
  exception when check_violation then
    raise notice 'PASS: an uploaded run needs a file name';
  end;
  begin
    insert into source_check_runs (source_id, idempotency_key, outcome, method, uploaded_file_name, requested_by)
    values ('e1000000-0000-0000-0000-000000000001', 'shape-2', 'unchanged', 'uploaded', 'x.pdf', null);
    raise exception 'FAIL: an uploaded run without a requester was accepted';
  exception when check_violation then
    raise notice 'PASS: an uploaded run needs a requester';
  end;
  begin
    insert into source_check_runs (source_id, idempotency_key, outcome, uploaded_file_name)
    values ('e1000000-0000-0000-0000-000000000001', 'shape-3', 'unchanged', 'x.pdf');
    raise exception 'FAIL: a fetched run with a file name was accepted';
  exception when check_violation then
    raise notice 'PASS: a fetched run cannot carry a file name';
  end;
  -- Control: a well-formed fetched run is accepted.
  insert into source_check_runs (source_id, idempotency_key, outcome)
  values ('e1000000-0000-0000-0000-000000000001', 'shape-ok', 'not_modified');
  raise notice 'PASS (control): a plain fetched run is still accepted';
end $$;

-- === 5. Publishing the uploaded capture ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare v_rev uuid;
begin
  v_rev := publish_source_revision((select id from upload_ids where name = 'capture'), '2026 Schedule of Fees', 'City of Vancouver',
    null, '2026-01-01', null, 'public', null, 'Uploaded copy checked against vancouver.ca.');
  if not source_revision_is_published(v_rev) then
    raise exception 'FAIL: the uploaded capture did not publish';
  end if;
  raise notice 'PASS: an uploaded capture publishes as a normal revision';
end $$;

rollback;
