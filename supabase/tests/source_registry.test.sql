-- Gate 6, sub-phase 6.3: proves the source registry
-- (20260806000094_copilot_source_registry.sql) behaves as designed:
--   1. record_source_check is service_role-only, idempotent on its key
--      (a replayed job step returns the first result and writes nothing),
--      stages changed content, recognises unchanged content, and records a
--      failure without touching the source.
--   2. Staged captures are visible to platform admins only.
--   3. Only a platform admin can publish or dismiss; publishing creates the
--      revision, its chunks, a 'verified' review and the decision at once;
--      a capture can be decided once.
--   4. search_source_evidence: exact jurisdiction filter (a decoy
--      municipality with the same words never leaks in), effective-date
--      selection, unpublished captures never searchable, and a withdrawn
--      revision disappears WITHOUT falling back to older text.
--   5. No direct INSERT into the new tables; append-only trigger.
--   6. source_check_status counts open captures only for admins.
--   7. publish_rule_set_version: admin-only, verified + same-permit-type
--      requirements only, jurisdiction must match, snapshot built from the
--      database, versions increment and supersede.
--
-- Control-then-assert throughout; expected failures are caught by SQLSTATE,
-- never `when others`.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
   'platform-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c7', 'authenticated', 'authenticated',
   'registry-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000d', 'platform_admin'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c7', 'member')
on conflict (org_id, user_id) do nothing;

-- Decoy municipality with its own permit type.
insert into jurisdictions (id, province_code, municipality)
values ('c7000000-0000-0000-0000-0000000000d1', 'ON', 'Decoyville Registry Test');
insert into permit_types (id, jurisdiction_id, title)
values ('c7000000-0000-0000-0000-0000000000d2', 'c7000000-0000-0000-0000-0000000000d1', 'Decoy permit');

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url) values
  ('c7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'forms_page', 'https://example.test/registry/toronto'),
  ('c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-0000000000d1', 'forms_page', 'https://example.test/registry/decoy'),
  ('c7000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000001', 'bylaw', 'https://example.test/registry/failing');

insert into permit_requirements (id, jurisdiction_id, permit_type_id, title, applies_when, source_id, verification_status, verified_by, verified_at)
values
  ('c7000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
   'Registry fixture: strata approval', 'If the building is strata titled.', 'c7000000-0000-0000-0000-000000000001',
   'verified', '10000000-0000-0000-0000-00000000000d', now()),
  ('c7000000-0000-0000-0000-0000000000a3', 'c7000000-0000-0000-0000-0000000000d1', 'c7000000-0000-0000-0000-0000000000d2',
   'Registry fixture: decoy requirement', null, 'c7000000-0000-0000-0000-000000000002',
   'verified', '10000000-0000-0000-0000-00000000000d', now());
insert into permit_requirements (id, jurisdiction_id, permit_type_id, title, verification_status)
values ('c7000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
        'Registry fixture: unverified requirement', 'unverified');

create temporary table registry_ids (name text primary key, id uuid) on commit drop;
grant all on registry_ids to authenticated, service_role;

create or replace function pg_temp.capture(p_text text) returns jsonb language sql as $$
  select jsonb_build_object(
    'content_sha256', encode(sha256(convert_to(p_text, 'UTF8')), 'hex'),
    'loader', 'text', 'loader_version', 'test',
    'text', p_text,
    'chunks', jsonb_build_array(jsonb_build_object('index', 0, 'locator', 'Document', 'content', p_text)));
$$;

-- === 1. record_source_check (service_role) ===
set local role service_role;

do $$
declare
  r1 record; r1b record; r2 record; r3 record; n int;
begin
  select * into r1 from record_source_check('c7000000-0000-0000-0000-000000000001', 'k1', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee alpha applies to every accessory building.'));
  if r1.outcome <> 'changed' or r1.capture_id is null then raise exception 'FAIL: first fetch should stage a capture, got %', r1.outcome; end if;
  insert into registry_ids values ('capture_alpha', r1.capture_id), ('run_k1', r1.check_run_id);
  raise notice 'PASS: a first fetch is staged as a capture (changed)';

  -- Replay of the same job step: same key.
  select * into r1b from record_source_check('c7000000-0000-0000-0000-000000000001', 'k1', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee alpha applies to every accessory building.'));
  select count(*) into n from source_check_runs where idempotency_key = 'k1';
  if r1b.check_run_id <> r1.check_run_id or n <> 1 then raise exception 'FAIL: replay wrote a second check (runs=%)', n; end if;
  select count(*) into n from source_captures where source_id = 'c7000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: replay staged a second capture (captures=%)', n; end if;
  raise notice 'PASS: a replayed step returns the first result and writes nothing (1 run, 1 capture)';

  select * into r2 from record_source_check('c7000000-0000-0000-0000-000000000001', 'k2', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee alpha applies to every accessory building.'));
  select count(*) into n from source_captures where source_id = 'c7000000-0000-0000-0000-000000000001';
  if r2.outcome <> 'unchanged' or r2.capture_id <> r1.capture_id or n <> 1 then
    raise exception 'FAIL: identical content should be unchanged (outcome=%, captures=%)', r2.outcome, n;
  end if;
  raise notice 'PASS: identical content on a new check is unchanged and links the existing capture';

  select * into r3 from record_source_check('c7000000-0000-0000-0000-000000000003', 'k3', 'failed', 503,
    p_error_code => 'http_error', p_error_message => 'HTTP 503.');
  if r3.outcome <> 'failed' or r3.capture_id is not null then raise exception 'FAIL: failed check recorded as %', r3.outcome; end if;
  if not exists (select 1 from jurisdiction_sources where id = 'c7000000-0000-0000-0000-000000000003'
                 and archived_at is null and verification_status = 'unverified') then
    raise exception 'FAIL: a failed check altered the source';
  end if;
  raise notice 'PASS: a failed fetch is recorded as failed and leaves the source untouched';

  begin
    perform record_source_check('c7000000-0000-0000-0000-000000000003', 'k3b', 'failed', 500);
    raise exception 'FAIL: a failure without an error code was accepted';
  exception when check_violation then
    raise notice 'PASS: a failure must carry an error code (check_violation)';
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c7","role":"authenticated"}';

do $$
begin
  perform record_source_check('c7000000-0000-0000-0000-000000000001', 'k-member', 'fetched', 200,
    p_capture => pg_temp.capture('Injected by a member.'));
  raise exception 'FAIL: authenticated could call record_source_check';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated cannot call record_source_check (control: service_role did above)';
end $$;

-- === 2/3. Captures are admin-only; only admins publish ===
do $$
declare n int;
begin
  select count(*) into n from source_captures;
  if n <> 0 then raise exception 'FAIL: a member can see % staged captures', n; end if;
  raise notice 'PASS: a member sees 0 staged captures (control below: the admin sees them)';

  perform publish_source_revision((select id from registry_ids where name = 'capture_alpha'), 'Toronto forms', 'City of Toronto',
    null, null, null, 'public', null, null);
  raise exception 'FAIL: a member published a revision';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot publish (insufficient_privilege)';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
declare v_rev uuid; n int; v_status text;
begin
  select count(*) into n from source_captures where source_id = 'c7000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: control: the admin should see the capture (saw %)', n; end if;

  v_rev := publish_source_revision((select id from registry_ids where name = 'capture_alpha'), 'Toronto forms', 'City of Toronto',
    null, null, null, 'public', null, 'Checked against the live page.');
  insert into registry_ids values ('rev1', v_rev);

  select count(*) into n from source_revision_chunks where source_revision_id = v_rev;
  select status into v_status from source_revision_reviews where source_revision_id = v_rev;
  if n <> 1 or v_status <> 'verified'
     or (select revision_number from source_revisions where id = v_rev) <> 1
     or (select created_by from source_revisions where id = v_rev) <> auth.uid()
     or not exists (select 1 from source_capture_decisions where source_revision_id = v_rev and decision = 'published') then
    raise exception 'FAIL: publication incomplete (chunks=%, review=%)', n, v_status;
  end if;
  raise notice 'PASS: the admin publishes: revision 1 + chunk + verified review + decision, actor = auth.uid()';

  begin
    perform publish_source_revision((select id from registry_ids where name = 'capture_alpha'), 'Again', 'City of Toronto',
      null, null, null, 'public', null, null);
    raise exception 'FAIL: a capture was published twice';
  exception when unique_violation then
    raise notice 'PASS: a capture can only be decided once (unique_violation)';
  end;
end $$;

-- More content: a future-effective revision 2, a decoy municipality, and an
-- unpublished capture.
reset role;
set local role service_role;
do $$
declare r record;
begin
  select * into r from record_source_check('c7000000-0000-0000-0000-000000000001', 'k4', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee beta replaces the old schedule next month.'));
  insert into registry_ids values ('capture_beta', r.capture_id);
  select * into r from record_source_check('c7000000-0000-0000-0000-000000000002', 'k5', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee gamma: Decoyville charges for every accessory building.'));
  insert into registry_ids values ('capture_gamma', r.capture_id);
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare v_rev uuid;
begin
  v_rev := publish_source_revision((select id from registry_ids where name = 'capture_beta'), 'Toronto forms', 'City of Toronto',
    null, current_date + 30, null, 'public', null, null);
  insert into registry_ids values ('rev2', v_rev);
  if (select supersedes_revision_id from source_revisions where id = v_rev) <> (select id from registry_ids where name = 'rev1')
     or (select revision_number from source_revisions where id = v_rev) <> 2 then
    raise exception 'FAIL: revision 2 should supersede revision 1';
  end if;
  perform publish_source_revision((select id from registry_ids where name = 'capture_gamma'), 'Decoy forms', 'Town of Decoyville',
    null, null, null, 'public', null, null);
  raise notice 'PASS: revision 2 supersedes revision 1; decoy municipality published';
end $$;

reset role;
set local role service_role;
do $$
declare r record;
begin
  select * into r from record_source_check('c7000000-0000-0000-0000-000000000001', 'k6', 'fetched', 200,
    p_content_type => 'text/plain', p_capture => pg_temp.capture('Permit fee delta was never reviewed.'));
  if r.outcome <> 'changed' then raise exception 'FAIL: delta should be staged'; end if;
end $$;

-- === 4. search_source_evidence (as a plain member) ===
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c7","role":"authenticated"}';

do $$
declare n int; v_content text;
begin
  -- Control: the decoy's text is published and searchable in its own jurisdiction.
  select count(*) into n from search_source_evidence('c7000000-0000-0000-0000-0000000000d1', 'permit fee accessory building');
  if n <> 1 then raise exception 'FAIL: control: decoy search should return its own row (got %)', n; end if;

  select count(*) into n from search_source_evidence('00000000-0000-0000-0001-000000000001', 'permit fee accessory building')
    where content like '%Decoyville%';
  if n <> 0 then raise exception 'FAIL: decoy municipality leaked into Toronto results'; end if;
  raise notice 'PASS: exact jurisdiction filter: same words in a decoy municipality never surface (control: decoy finds its own)';

  select string_agg(content, ' | ') into v_content from search_source_evidence('00000000-0000-0000-0001-000000000001', 'permit fee', current_date);
  if v_content is null or v_content not like '%alpha%' or v_content like '%beta%' then
    raise exception 'FAIL: as of today Toronto should return revision 1 only, got %', v_content;
  end if;
  select string_agg(content, ' | ') into v_content from search_source_evidence('00000000-0000-0000-0001-000000000001', 'permit fee', current_date + 40);
  if v_content is null or v_content not like '%beta%' or v_content like '%alpha%' then
    raise exception 'FAIL: after the effective date Toronto should return revision 2 only, got %', v_content;
  end if;
  raise notice 'PASS: effective dates select the revision in force (today: rev 1; +40 days: rev 2)';

  select count(*) into n from search_source_evidence('00000000-0000-0000-0001-000000000001', 'delta reviewed');
  if n <> 0 then raise exception 'FAIL: unpublished capture text is searchable'; end if;
  raise notice 'PASS: unpublished (staged) text is never searchable';
end $$;

reset role;
do $$
begin
  if not exists (select 1 from source_captures where text_content like '%delta%') then
    raise exception 'FAIL: control: the delta capture should exist';
  end if;
  raise notice 'PASS: control: the unsearchable delta capture exists';
end $$;

-- Withdraw revision 1: it must disappear, with no fallback.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
-- reviewed_at is explicit only because this whole file is one transaction
-- (now() = transaction start); a real withdrawal is a later transaction.
insert into source_revision_reviews (source_revision_id, status, notes, reviewed_by, reviewed_at)
select id, 'disputed', 'Superseded by a correction notice.', auth.uid(), clock_timestamp() from registry_ids where name = 'rev1';

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c7","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from source_revision_chunks where source_revision_id = (select id from registry_ids where name = 'rev1');
  if n <> 0 then raise exception 'FAIL: a member still sees chunks of a withdrawn revision'; end if;
  select count(*) into n from search_source_evidence('00000000-0000-0000-0001-000000000001', 'permit fee', current_date);
  if n <> 0 then raise exception 'FAIL: withdrawn revision still searchable or fell back (rows=%)', n; end if;
  select count(*) into n from search_source_evidence('00000000-0000-0000-0001-000000000001', 'permit fee', current_date + 40);
  if n <> 1 then raise exception 'FAIL: control: revision 2 should still be searchable after its date (rows=%)', n; end if;
  raise notice 'PASS: a withdrawn revision disappears at once with no fallback (control: rev 2 still found after its date)';
end $$;

reset role;
do $$
begin
  if not exists (select 1 from source_revision_chunks where source_revision_id = (select id from registry_ids where name = 'rev1')) then
    raise exception 'FAIL: control: rev 1 chunk should still exist (append-only)';
  end if;
  raise notice 'PASS: control: the withdrawn chunk still exists; it is hidden, not deleted';
end $$;

-- === 5. No direct writes; append-only ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
begin
  insert into source_revision_chunks (source_revision_id, chunk_index, locator, content)
  values ((select id from registry_ids where name = 'rev2'), 99, 'Forged', 'Forged requirement text.');
  raise exception 'FAIL: an admin inserted a chunk directly';
exception when insufficient_privilege then
  raise notice 'PASS: no direct INSERT into source_revision_chunks, even for an admin';
end $$;

reset role;
set local role service_role;
do $$
begin
  insert into source_captures (source_id, content_sha256, content_type, loader, loader_version, text_content, chunks)
  values ('c7000000-0000-0000-0000-000000000001', repeat('e', 64), 'text/plain', 'text', 't', 'x', '[{"index":0}]');
  raise exception 'FAIL: service_role inserted a capture directly';
exception when insufficient_privilege then
  raise notice 'PASS: no direct INSERT into source_captures for service_role (only via record_source_check)';
end $$;

reset role;
do $$
begin
  update source_captures set text_content = 'rewritten' where id = (select id from registry_ids where name = 'capture_alpha');
  raise exception 'FAIL: a capture was rewritten';
exception when raise_exception then
  raise notice 'PASS: append-only trigger blocks UPDATE on source_captures (as postgres)';
end $$;

do $$
begin
  delete from source_check_runs where idempotency_key = 'k1';
  raise exception 'FAIL: a check run was deleted';
exception when raise_exception then
  raise notice 'PASS: append-only trigger blocks DELETE on source_check_runs (as postgres)';
end $$;

-- === 6. source_check_status ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c7","role":"authenticated"}';
do $$
declare s record;
begin
  select * into s from source_check_status() where source_id = 'c7000000-0000-0000-0000-000000000001';
  if s.last_success_at is null or s.open_captures <> 0 then
    raise exception 'FAIL: member status row wrong (success=%, open=%)', s.last_success_at, s.open_captures;
  end if;
  raise notice 'PASS: a member sees check status but 0 open captures';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare s record;
begin
  select * into s from source_check_status() where source_id = 'c7000000-0000-0000-0000-000000000001';
  if s.open_captures <> 1 then raise exception 'FAIL: the admin should see 1 open capture (saw %)', s.open_captures; end if;
  select * into s from source_check_status() where source_id = 'c7000000-0000-0000-0000-000000000003';
  if s.last_outcome <> 'failed' or s.last_success_at is not null then
    raise exception 'FAIL: a failed check must not count as a success';
  end if;
  raise notice 'PASS: the admin sees 1 open capture; a failed check is never a successful check';
end $$;

-- === 7. publish_rule_set_version ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c7","role":"authenticated"}';
do $$
begin
  perform publish_rule_set_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', null,
    '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a1", "condition": null}]');
  raise exception 'FAIL: a member published a rule set';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot publish a rule set';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare v1 uuid; v2 uuid; snap jsonb; src uuid;
begin
  begin
    perform publish_rule_set_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', null,
      '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a2", "condition": null}]');
    raise exception 'FAIL: an unverified requirement was published';
  exception when check_violation then
    raise notice 'PASS: an unverified requirement cannot be published (check_violation)';
  end;

  begin
    perform publish_rule_set_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', null,
      '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a3", "condition": null}]');
    raise exception 'FAIL: another permit type''s requirement was published';
  exception when check_violation then
    raise notice 'PASS: a requirement of another permit type cannot be published (check_violation)';
  end;

  begin
    perform publish_rule_set_version('00000000-0000-0000-0001-000000000001', 'c7000000-0000-0000-0000-0000000000d2', null,
      '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a3", "condition": null}]');
    raise exception 'FAIL: a permit type was published under the wrong jurisdiction';
  exception when foreign_key_violation then
    raise notice 'PASS: permit type and jurisdiction must match (foreign_key_violation)';
  end;

  v1 := publish_rule_set_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'First',
    '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a1",
       "condition": {"fact": "building.strata_titled", "op": "eq", "value": true}, "title": "Forged title"}]');
  select requirement_snapshot, source_revision_id into snap, src from rule_set_version_items where rule_set_version_id = v1;
  if snap->>'title' <> 'Registry fixture: strata approval'
     or snap->>'applies_when_text' <> 'If the building is strata titled.'
     or snap->'condition'->>'fact' <> 'building.strata_titled'
     or snap->'requires' <> '[]'::jsonb
     or (select published_by from rule_set_versions where id = v1) <> auth.uid() then
    raise exception 'FAIL: snapshot not built from the database: %', snap;
  end if;
  if src is distinct from (select id from registry_ids where name = 'rev2') then
    raise exception 'FAIL: item should cite the newest published revision of its source (rev 2), got %', src;
  end if;
  raise notice 'PASS: snapshot comes from the database (a forged title is ignored), condition kept, cites the newest published revision';

  v2 := publish_rule_set_version('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'Second',
    '[{"permit_requirement_id": "c7000000-0000-0000-0000-0000000000a1", "condition": null}]');
  if (select version from rule_set_versions where id = v2) <> (select version from rule_set_versions where id = v1) + 1
     or (select supersedes_rule_set_id from rule_set_versions where id = v2) <> v1
     or (select requirement_snapshot->'condition' from rule_set_version_items where rule_set_version_id = v1) = 'null'::jsonb then
    raise exception 'FAIL: version 2 should increment, supersede v1, and leave v1 unchanged';
  end if;
  raise notice 'PASS: a new version increments and supersedes; the earlier version is unchanged';
end $$;

rollback;
