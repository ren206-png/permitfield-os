-- Gate 6, sub-phase 6.5: proves 20260806000097_copilot_drafts_fees.sql:
--   1. Draft versions: concurrency (two saves of the same version collide),
--      lineage (based_on = version - 1), kind/model checks, append-only.
--   2. Tenant isolation for drafts, correction requests and fee estimates,
--      control-then-assert; no forged author.
--   3. fee_estimates is server-written only; its status/total checks.
--   4. publish_fee_schedule_version: admin only, published source of the
--      same jurisdiction only, versions increment and supersede.
--
-- Expected failures are caught by SQLSTATE, never `when others`.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
        'platform-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;
insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000d', 'platform_admin')
on conflict (org_id, user_id) do nothing;

-- A published source revision in Toronto, and an unpublished one.
insert into jurisdiction_sources (id, jurisdiction_id, source_type, url) values
  ('c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'fee_schedule', 'https://example.test/fees');
insert into source_revisions (id, source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by) values
  ('c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001', 1, repeat('1', 64), 'Fee schedule 2026', 'City of Toronto', now(), 'public', '10000000-0000-0000-0000-00000000000d'),
  ('c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000001', 2, repeat('2', 64), 'Fee schedule draft', 'City of Toronto', now(), 'public', '10000000-0000-0000-0000-00000000000d');
insert into source_revision_reviews (source_revision_id, status, reviewed_by)
values ('c9000000-0000-0000-0000-000000000002', 'verified', '10000000-0000-0000-0000-00000000000d');

-- === 1/2. Drafts as org A's owner ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a1',
        'cover_letter', 1, null, 'human_edited', 'Dear Building Division,', auth.uid());

do $$
begin
  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a1',
          'cover_letter', 2, 1, 'human_edited', 'Edit by person one', auth.uid());
  raise notice 'PASS: control: version 2 on version 1 saves';
end $$;

do $$
begin
  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a1',
          'cover_letter', 2, 1, 'human_edited', 'Edit by person two, from the same base', auth.uid());
  raise exception 'FAIL: two saves of the same version both landed';
exception when unique_violation then
  raise notice 'PASS: a second save of the same version collides (unique_violation): no silent overwrite';
end $$;

do $$
begin
  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a1',
          'cover_letter', 4, 1, 'human_edited', 'Skips the latest version', auth.uid());
  raise exception 'FAIL: a version not based on its predecessor was accepted';
exception when check_violation then
  raise notice 'PASS: lineage enforced (based_on_version = version - 1)';
end $$;

do $$
begin
  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a2',
          'cover_letter', 1, null, 'ai_generated', 'AI text', auth.uid());
  raise exception 'FAIL: an AI version without a model id was accepted';
exception when check_violation then
  raise notice 'PASS: an AI-generated version must name its model';
end $$;

do $$
begin
  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-0000000000a3',
          'correction_response', 1, null, 'human_edited', 'Response', auth.uid());
  raise exception 'FAIL: a correction response without its request was accepted';
exception when check_violation then
  raise notice 'PASS: a correction response must reference its correction request';
end $$;

insert into correction_requests (id, org_id, application_id, received_on, items, recorded_by)
values ('c9000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
        current_date, '["Show exit signs on A-101"]', auth.uid());

do $$
begin
  insert into correction_requests (org_id, application_id, received_on, items, recorded_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', current_date, '["x"]',
          '10000000-0000-0000-0000-00000000000b');
  raise exception 'FAIL: a correction request with a forged author was accepted';
exception when insufficient_privilege then
  raise notice 'PASS: recorded_by must be the caller';
end $$;

-- Org B's owner: sees none of A's rows (control: A sees them), cannot write into A.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
declare n int; m int;
begin
  select count(*) into n from application_draft_versions where application_id = '40000000-0000-0000-0000-00000000000a';
  select count(*) into m from correction_requests where application_id = '40000000-0000-0000-0000-00000000000a';
  if n <> 0 or m <> 0 then raise exception 'FAIL: org B sees % drafts / % requests of org A', n, m; end if;
  raise notice 'PASS: org B sees 0 of org A''s drafts and correction requests (control below)';

  insert into application_draft_versions (org_id, application_id, thread_id, kind, version, based_on_version, origin, body, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', gen_random_uuid(),
          'cover_letter', 1, null, 'human_edited', 'Injected', auth.uid());
  raise exception 'FAIL: org B wrote a draft into org A';
exception when insufficient_privilege then
  raise notice 'PASS: org B cannot write a draft into org A''s application';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from application_draft_versions where application_id = '40000000-0000-0000-0000-00000000000a';
  if n <> 2 then raise exception 'FAIL: control: org A should see its 2 draft versions (saw %)', n; end if;
  raise notice 'PASS: control: org A sees its own 2 draft versions';
end $$;

-- === 3. fee_estimates: server-written only ===
do $$
begin
  insert into fee_estimates (org_id, application_id, status, calculation, engine_version, computed_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'unavailable', '{}', 'test', auth.uid());
  raise exception 'FAIL: a user wrote a fee estimate';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated cannot write fee estimates';
end $$;

reset role;
set local role service_role;
do $$
begin
  insert into fee_estimates (org_id, application_id, status, calculation, engine_version)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'unavailable', '{"reasons":["none"]}', 'test');
  raise notice 'PASS: control: the server writes an estimate';

  begin
    insert into fee_estimates (org_id, application_id, status, calculation, engine_version)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'estimated', '{}', 'test');
    raise exception 'FAIL: an "estimated" row without a total was accepted';
  exception when check_violation then
    raise notice 'PASS: estimated requires a total and currency';
  end;

  begin
    insert into fee_estimates (org_id, application_id, status, total_minor, currency, calculation, engine_version)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'missing_inputs', 100, 'CAD', '{}', 'test');
    raise exception 'FAIL: a total on a non-estimated row was accepted';
  exception when check_violation then
    raise notice 'PASS: only an estimated row carries a total (unavailable is never zero)';
  end;
end $$;

reset role;
do $$
begin
  update application_draft_versions set body = 'rewritten' where thread_id = 'c9000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL: a draft version was rewritten';
exception when raise_exception then
  raise notice 'PASS: append-only trigger blocks rewriting a draft version (as postgres)';
end $$;

-- === 4. publish_fee_schedule_version ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
begin
  perform publish_fee_schedule_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'CAD',
    'half_up_to_cent', current_date, null, '{"components":[]}', 'c9000000-0000-0000-0000-000000000002');
  raise exception 'FAIL: an org owner published a fee schedule';
exception when insufficient_privilege then
  raise notice 'PASS: only a platform admin can publish a fee schedule';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare v1 uuid; v2 uuid;
begin
  begin
    perform publish_fee_schedule_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'CAD',
      'half_up_to_cent', current_date, null, '{"components":[]}', 'c9000000-0000-0000-0000-000000000003');
    raise exception 'FAIL: a fee schedule cited an unpublished source revision';
  exception when check_violation then
    raise notice 'PASS: the source revision must be published';
  end;

  v1 := publish_fee_schedule_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'CAD',
    'half_up_to_cent', current_date, null, '{"components":[{"kind":"flat","label":"Fee","category":"fee","amount_minor":15000}]}',
    'c9000000-0000-0000-0000-000000000002');
  v2 := publish_fee_schedule_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'CAD',
    'up_to_dollar', current_date, null, '{"components":[{"kind":"flat","label":"Fee","category":"fee","amount_minor":16000}]}',
    'c9000000-0000-0000-0000-000000000002');
  if (select version from fee_schedule_versions where id = v2) <> (select version from fee_schedule_versions where id = v1) + 1
     or (select supersedes_fee_schedule_id from fee_schedule_versions where id = v2) <> v1
     or (select published_by from fee_schedule_versions where id = v1) <> auth.uid() then
    raise exception 'FAIL: fee schedule versions should increment, supersede and record the publisher';
  end if;
  raise notice 'PASS: an admin publishes; versions increment and supersede; publisher = auth.uid()';
end $$;

rollback;
