-- correct_source_revision (20260806000103):
--   1. A platform admin corrects the newest published revision: a new
--      revision with the same text (hash + chunks copied), corrected dates,
--      linked by corrects/supersedes, with a 'verified' review; the original
--      row is unchanged but retired ('stale', superseded).
--   2b. When the correction narrows the window, a date only the original
--      covered finds nothing -- not the original's wrong details.
--   2. search_source_evidence then returns the correction for a date the
--      original's typo excluded.
--   3. A member is refused; nothing is written.
--   4. Only the newest revision can be corrected; notes are required; a
--      withdrawn revision can't be corrected.
--   5. Ordinary revisions still can't repeat a text (the partial unique
--      index keeps 094's guarantee).
--
-- Control-then-assert; expected failures are caught by SQLSTATE.
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated',
   'correct-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated',
   'correct-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f1', 'platform_admin'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f2', 'member')
on conflict (org_id, user_id) do nothing;

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url)
values ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002', 'fee_schedule', 'https://example.test/correct/fees');

create or replace function pg_temp.capture(p_text text) returns jsonb language sql as $$
  select jsonb_build_object(
    'content_sha256', encode(sha256(convert_to(p_text, 'UTF8')), 'hex'),
    'loader', 'text', 'loader_version', 'test',
    'text', p_text,
    'chunks', jsonb_build_array(
      jsonb_build_object('index', 0, 'locator', 'p. 1', 'content', p_text),
      jsonb_build_object('index', 1, 'locator', 'p. 2', 'content', 'Correctfixture surcharge four percent')));
$$;

create temporary table correct_ids (name text primary key, id uuid) on commit drop;
grant all on correct_ids to authenticated, service_role;

set local role service_role;
do $$
declare r record;
begin
  select * into r from record_source_check('f1000000-0000-0000-0000-000000000001', 'correct-k1', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Correctfixture processing fee one hundred twelve dollars'));
  insert into correct_ids values ('capture', r.capture_id);
end $$;

-- Publish revision 1 with the typo.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
do $$
begin
  insert into correct_ids values ('rev1', publish_source_revision((select id from correct_ids where name = 'capture'),
    'Fee schedule', 'City of Calgary', null, '2926-01-01', null, 'public_no_redistribution', null, 'typo'));
end $$;

-- === 3. A member is refused ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
do $$
begin
  begin
    perform correct_source_revision((select id from correct_ids where name = 'rev1'), 'Fee schedule', 'City of Calgary',
      null, '2026-01-01', null, 'public_no_redistribution', null, 'member try');
    raise exception 'FAIL: a member corrected a revision';
  exception when insufficient_privilege then
    raise notice 'PASS: a member cannot correct a revision';
  end;
end $$;

-- === 1 + 2 + 4. The admin ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
do $$
declare v_old source_revisions%rowtype; v_new source_revisions%rowtype; v_id uuid; n_old int; n_new int; hit uuid;
begin
  if (select count(*) from source_revisions where source_id = 'f1000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: control: the refused call should have written nothing';
  end if;

  -- Control: the typo keeps revision 1 out of evidence for a 2026 date.
  select source_revision_id into hit from search_source_evidence('00000000-0000-0000-0001-000000000002', 'Correctfixture', '2026-06-01') limit 1;
  if hit is not null then raise exception 'FAIL: control: revision 1 (effective 2926) should not be found for 2026'; end if;

  begin
    perform correct_source_revision((select id from correct_ids where name = 'rev1'), 'Fee schedule', 'City of Calgary',
      null, '2026-01-01', null, 'public_no_redistribution', null, '   ');
    raise exception 'FAIL: a correction without notes was accepted';
  exception when invalid_parameter_value then
    raise notice 'PASS: a correction needs notes';
  end;

  v_id := correct_source_revision((select id from correct_ids where name = 'rev1'), 'Fee schedule (R2026-02)', 'City of Calgary',
    null, '2026-01-01', '2026-12-31', 'public_no_redistribution', null, 'effective date typo (2926 -> 2026)');
  insert into correct_ids values ('rev2', v_id);
  select * into v_old from source_revisions where id = (select id from correct_ids where name = 'rev1');
  select * into v_new from source_revisions where id = v_id;
  select count(*) into n_old from source_revision_chunks where source_revision_id = v_old.id;
  select count(*) into n_new from source_revision_chunks where source_revision_id = v_new.id;

  if v_new.revision_number <> 2 or v_new.content_sha256 <> v_old.content_sha256 or v_new.corrects_revision_id <> v_old.id
     or v_new.supersedes_revision_id <> v_old.id or v_new.effective_from <> '2026-01-01' or v_new.effective_to <> '2026-12-31'
     or v_new.title <> 'Fee schedule (R2026-02)' or v_new.created_by <> auth.uid() or v_new.retrieved_at <> v_old.retrieved_at
     or n_new <> n_old or n_new <> 2 or not source_revision_is_published(v_new.id)
     or v_old.effective_from <> '2926-01-01' or source_revision_is_published(v_old.id)
     or (select status from source_revision_reviews where source_revision_id = v_old.id order by reviewed_at desc limit 1) <> 'stale' then
    raise exception 'FAIL: correction recorded wrongly (new %, chunks % / %)', row_to_json(v_new), n_new, n_old;
  end if;
  if (select notes from source_revision_reviews where source_revision_id = v_id) not like 'Correction of revision 1: effective date typo%' then
    raise exception 'FAIL: the review should say what was corrected';
  end if;
  raise notice 'PASS: the admin corrects: same text and chunks, new dates, linked, verified; the original is unchanged and retired';

  select source_revision_id into hit from search_source_evidence('00000000-0000-0000-0001-000000000002', 'Correctfixture', '2026-06-01') limit 1;
  if hit is distinct from v_id then raise exception 'FAIL: evidence for 2026 should come from the correction (got %)', hit; end if;
  raise notice 'PASS: search_source_evidence returns the correction for 2026';

  -- 2b. The correction ends 2026-12-31; the original (2926 -> open) covered
  -- 2930. It is retired, so 2930 finds nothing rather than its wrong details.
  select source_revision_id into hit from search_source_evidence('00000000-0000-0000-0001-000000000002', 'Correctfixture', '2930-06-01') limit 1;
  if hit is not null then raise exception 'FAIL: the retired original answered for a date outside the correction (got %)', hit; end if;
  raise notice 'PASS: a narrowed correction leaves no stale answer outside its window';

  begin
    perform correct_source_revision((select id from correct_ids where name = 'rev1'), 'Fee schedule', 'City of Calgary',
      null, '2026-01-01', null, 'public_no_redistribution', null, 'again');
    raise exception 'FAIL: an older revision was corrected';
  exception when check_violation then
    raise notice 'PASS: only the newest revision can be corrected';
  end;
end $$;

-- A withdrawn newest revision can't be corrected.
do $$
begin
  -- clock_timestamp(): in this one transaction now() would date the
  -- withdrawal before the correction's own review.
  insert into source_revision_reviews (source_revision_id, status, notes, reviewed_by, reviewed_at)
  values ((select id from correct_ids where name = 'rev2'), 'disputed', 'withdrawn for the test', auth.uid(), clock_timestamp());
  begin
    perform correct_source_revision((select id from correct_ids where name = 'rev2'), 'Fee schedule', 'City of Calgary',
      null, '2026-01-01', null, 'public_no_redistribution', null, 'fix a withdrawn one');
    raise exception 'FAIL: a withdrawn revision was corrected';
  exception when check_violation then
    raise notice 'PASS: a withdrawn revision cannot be corrected';
  end;
end $$;

-- === 5. Ordinary revisions still can't repeat a text (as postgres) ===
reset role;
do $$
declare v_rev1 source_revisions%rowtype;
begin
  select * into v_rev1 from source_revisions where id = (select id from correct_ids where name = 'rev1');
  begin
    insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
    values (v_rev1.source_id, 9, v_rev1.content_sha256, 'Duplicate', 'City of Calgary', now(), 'public', v_rev1.created_by);
    raise exception 'FAIL: an ordinary revision repeated a text';
  exception when unique_violation then
    raise notice 'PASS: ordinary revisions still cannot repeat a text';
  end;
end $$;

rollback;
