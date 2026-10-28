-- Gate 6, sub-phase 6.1: proves the copilot foundation tables
-- (20260806000091_copilot_catalogue_foundation.sql,
--  20260806000092_copilot_project_foundation.sql) behave as designed:
--   1. Catalogue tables: only a platform_admin acting as themselves can
--      insert; a plain owner, a forged actor and anon cannot.
--   2. CHECK constraints reject bad hashes, inverted date windows, a
--      'verified' coverage claim without a source, bad currency codes, a fee
--      schedule without a source, and 'not_applicable' without a rule set.
--   3. Tenant isolation for project_facts, project_requirement_snapshots and
--      copilot_tool_invocations, control-then-assert: each cross-tenant
--      0-row read is paired with a control proving the row exists and the
--      same caller sees their own.
--   4. Append-only on all nine tables, at both layers: no UPDATE/DELETE
--      privilege for authenticated/service_role (loud 42501, not a silent
--      0-row RLS miss), and the forbid_update_delete() trigger for a role
--      that does hold the privilege (postgres).
--   5. No TRUNCATE for anon/authenticated/service_role on any of the nine
--      (Supabase's default privileges grant it on new tables).
--
-- Expected failures are caught by SQLSTATE (insufficient_privilege,
-- check_violation, ...), never `when others`, so an unrelated error still
-- fails the test instead of passing it.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
-- Platform admin: the same fixture user jurisdiction_sources.test.sql uses.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
   'platform-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c6', 'authenticated', 'authenticated',
   'copilot-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000d', 'platform_admin'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c6', 'member')
on conflict (org_id, user_id) do nothing;

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url)
values ('c6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'fee_schedule',
        'https://example.test/copilot-foundation/fees');

insert into permit_requirements (id, jurisdiction_id, permit_type_id, title)
values ('c6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000001',
        '00000000-0000-0000-0003-000000000001', 'Copilot foundation fixture requirement');

-- === 1. Catalogue writes ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

-- Control: the platform admin can insert one row into each catalogue table.
do $$
begin
  insert into source_revisions (id, source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
  values ('c6000000-0000-0000-0000-000000000010', 'c6000000-0000-0000-0000-000000000001', 1, repeat('a', 64),
          'Fixture fee schedule 2026', 'City of Toronto', now(), 'public', auth.uid());
  insert into source_revision_reviews (id, source_revision_id, status, reviewed_by)
  values ('c6000000-0000-0000-0000-000000000011', 'c6000000-0000-0000-0000-000000000010', 'verified', auth.uid());
  insert into coverage_records (id, jurisdiction_id, permit_type_id, project_scope, coverage_level, effective_from, source_revision_id, created_by)
  values ('c6000000-0000-0000-0000-000000000012', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
          'commercial_tenant_improvement', 'verified', current_date, 'c6000000-0000-0000-0000-000000000010', auth.uid());
  insert into rule_set_versions (id, jurisdiction_id, permit_type_id, version, published_by)
  values ('c6000000-0000-0000-0000-000000000013', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 1, auth.uid());
  insert into rule_set_version_items (id, rule_set_version_id, permit_requirement_id, requirement_snapshot, source_revision_id)
  values ('c6000000-0000-0000-0000-000000000014', 'c6000000-0000-0000-0000-000000000013', 'c6000000-0000-0000-0000-000000000002',
          '{"title": "Copilot foundation fixture requirement"}', 'c6000000-0000-0000-0000-000000000010');
  insert into fee_schedule_versions (id, jurisdiction_id, permit_type_id, version, rounding_rule, effective_from, parameters, source_revision_id, published_by)
  values ('c6000000-0000-0000-0000-000000000015', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 1,
          'half_up_to_cent', current_date, '{"base_minor_units": 25000}', 'c6000000-0000-0000-0000-000000000010', auth.uid());
  raise notice 'PASS (control): platform_admin inserted one row into each of the six catalogue tables';
end $$;

-- A platform admin cannot attribute a row to someone else.
do $$
declare blocked boolean := false;
begin
  begin
    insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
    values ('c6000000-0000-0000-0000-000000000001', 2, repeat('b', 64), 'Forged', 'City of Toronto', now(), 'public',
            '10000000-0000-0000-0000-00000000000a');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: platform_admin inserted a source_revisions row attributed to another user';
  end if;
  raise notice 'PASS: forged created_by on source_revisions rejected by RLS';
end $$;

-- A plain owner cannot write any catalogue table.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  stmt text;
  blocked boolean;
begin
  foreach stmt in array array[
    format($f$insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
              values ('c6000000-0000-0000-0000-000000000001', 3, repeat('c', 64), 'x', 'x', now(), 'public', %L)$f$, auth.uid()),
    format($f$insert into source_revision_reviews (source_revision_id, status, reviewed_by)
              values ('c6000000-0000-0000-0000-000000000010', 'disputed', %L)$f$, auth.uid()),
    format($f$insert into coverage_records (jurisdiction_id, project_scope, coverage_level, effective_from, created_by)
              values ('00000000-0000-0000-0001-000000000001', 'any', 'listed', current_date, %L)$f$, auth.uid()),
    format($f$insert into rule_set_versions (jurisdiction_id, permit_type_id, version, published_by)
              values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 9, %L)$f$, auth.uid()),
    $f$insert into rule_set_version_items (rule_set_version_id, permit_requirement_id, requirement_snapshot)
       values ('c6000000-0000-0000-0000-000000000013', 'c6000000-0000-0000-0000-000000000002', '{}')$f$,
    format($f$insert into fee_schedule_versions (jurisdiction_id, version, rounding_rule, effective_from, parameters, source_revision_id, published_by)
              values ('00000000-0000-0000-0001-000000000001', 9, 'half_up_to_cent', current_date, '{}', 'c6000000-0000-0000-0000-000000000010', %L)$f$, auth.uid())
  ] loop
    blocked := false;
    begin
      execute stmt;
    exception when insufficient_privilege then blocked := true;
    end;
    if not blocked then
      raise exception 'FAIL: plain owner inserted into a catalogue table: %', left(stmt, 60);
    end if;
  end loop;
  raise notice 'PASS: plain owner is denied INSERT on all six catalogue tables';
end $$;

-- Control for the owner case: the same owner CAN read the catalogue, so the
-- denials above are the write gate, not a broken connection or grant.
do $$
declare n int;
begin
  select count(*) into n from source_revisions where id = 'c6000000-0000-0000-0000-000000000010';
  if n <> 1 then
    raise exception 'FAIL (control): signed-in owner should read the catalogue row, got %', n;
  end if;
  raise notice 'PASS (control): signed-in owner can read the catalogue';
end $$;

-- anon has no grant at all.
set local role anon;
do $$
declare blocked boolean := false;
begin
  begin
    perform 1 from source_revisions limit 1;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: anon can read source_revisions';
  end if;
  raise notice 'PASS: anon cannot read source_revisions';
end $$;

-- === 2. CHECK constraints (as postgres, so only the constraint can reject) ===
reset role;

do $$
declare
  stmt text;
  rejected boolean;
begin
  foreach stmt in array array[
    -- bad hash
    $f$insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by)
       values ('c6000000-0000-0000-0000-000000000001', 4, 'not-a-sha', 'x', 'x', now(), 'public', '10000000-0000-0000-0000-00000000000d')$f$,
    -- inverted effective window
    $f$insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, retrieved_at, access_scope, created_by, effective_from, effective_to)
       values ('c6000000-0000-0000-0000-000000000001', 5, repeat('d', 64), 'x', 'x', now(), 'public', '10000000-0000-0000-0000-00000000000d', '2026-12-31', '2026-01-01')$f$,
    -- 'verified' coverage with no source revision
    $f$insert into coverage_records (jurisdiction_id, project_scope, coverage_level, effective_from, created_by)
       values ('00000000-0000-0000-0001-000000000001', 'any', 'verified', current_date, '10000000-0000-0000-0000-00000000000d')$f$,
    -- lower-case currency
    $f$insert into fee_schedule_versions (jurisdiction_id, version, currency, rounding_rule, effective_from, parameters, source_revision_id, published_by)
       values ('00000000-0000-0000-0001-000000000001', 7, 'cad', 'half_up_to_cent', current_date, '{}', 'c6000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-00000000000d')$f$,
    -- 'not_applicable' with no rule set
    $f$insert into project_requirement_snapshots (org_id, project_id, outcome, explanation)
       values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'not_applicable', '{}')$f$,
    -- confirmed fact with no reviewer
    $f$insert into project_facts (org_id, project_id, fact_key, value, provenance, state, created_by)
       values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'floor_area', '111', 'user_entered', 'confirmed', '10000000-0000-0000-0000-00000000000a')$f$,
    -- failed tool call with no error message
    $f$insert into copilot_tool_invocations (org_id, user_id, trace_id, tool_name, arguments, status)
       values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'get_permit_requirements', '{}', 'failed')$f$
  ] loop
    rejected := false;
    begin
      execute stmt;
    exception when check_violation then rejected := true;
    end;
    if not rejected then
      raise exception 'FAIL: CHECK constraint did not reject: %', left(stmt, 80);
    end if;
  end loop;
  raise notice 'PASS: all seven CHECK constraints reject their bad rows';
end $$;

do $$
declare rejected boolean := false;
begin
  begin
    insert into fee_schedule_versions (jurisdiction_id, version, rounding_rule, effective_from, parameters, published_by)
    values ('00000000-0000-0000-0001-000000000001', 8, 'half_up_to_cent', current_date, '{}', '10000000-0000-0000-0000-00000000000d');
  exception when not_null_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: fee schedule without a source revision was accepted';
  end if;
  raise notice 'PASS: a fee schedule must cite a source revision';
end $$;

-- === 3. Tenant isolation ===
-- Org B rows written by server code (service_role).
set local role service_role;
insert into project_facts (id, org_id, project_id, fact_key, value, provenance)
values ('c6000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-00000000000b',
        '50000000-0000-0000-0000-00000000000b', 'electrical.service_amps', '400', 'document_extraction');
insert into project_requirement_snapshots (id, org_id, project_id, outcome, explanation) values
  ('c6000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 'unknown', '{"missing": ["floor_area"]}'),
  ('c6000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'applicable', '{}');
insert into copilot_tool_invocations (id, org_id, project_id, user_id, trace_id, tool_name, arguments, status) values
  ('c6000000-0000-0000-0000-000000000040', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'get_permit_requirements', '{}', 'succeeded'),
  ('c6000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b',
   '10000000-0000-0000-0000-00000000000b', gen_random_uuid(), 'get_permit_requirements', '{}', 'succeeded');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- Org A owner records a fact for their own project (control for the denials below).
do $$
begin
  insert into project_facts (id, org_id, project_id, fact_key, value, unit, provenance, created_by)
  values ('c6000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-00000000000a',
          '50000000-0000-0000-0000-00000000000a', 'floor_area', '111', 'm2', 'user_entered', auth.uid());
  insert into project_facts (org_id, project_id, fact_key, value, provenance, state, reviewed_by, reviewed_at, supersedes_fact_id, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'floor_area', '118',
          'user_entered', 'confirmed', auth.uid(), now(), 'c6000000-0000-0000-0000-000000000021', auth.uid());
  raise notice 'PASS (control): org A owner recorded a proposed fact and a confirmed correction that supersedes it';
end $$;

do $$
declare
  cross_facts int; own_facts int;
  cross_snaps int; own_snaps int;
  cross_tools int; own_tools int;
begin
  select count(*) into cross_facts from project_facts where org_id = '20000000-0000-0000-0000-00000000000b';
  select count(*) into own_facts from project_facts where org_id = '20000000-0000-0000-0000-00000000000a';
  select count(*) into cross_snaps from project_requirement_snapshots where org_id = '20000000-0000-0000-0000-00000000000b';
  select count(*) into own_snaps from project_requirement_snapshots where org_id = '20000000-0000-0000-0000-00000000000a';
  select count(*) into cross_tools from copilot_tool_invocations where org_id = '20000000-0000-0000-0000-00000000000b';
  select count(*) into own_tools from copilot_tool_invocations where org_id = '20000000-0000-0000-0000-00000000000a';
  if own_facts <> 2 or own_snaps <> 1 or own_tools <> 1 then
    raise exception 'FAIL (control): org A owner should see own rows (facts 2, snapshots 1, tools 1), got %, %, %', own_facts, own_snaps, own_tools;
  end if;
  if cross_facts <> 0 or cross_snaps <> 0 or cross_tools <> 0 then
    raise exception 'FAIL: org A owner read org B rows (facts %, snapshots %, tools %)', cross_facts, cross_snaps, cross_tools;
  end if;
  raise notice 'PASS: org A owner sees own facts/snapshots/tool calls and none of org B''s, which exist (inserted above)';
end $$;

-- Writes into another org, a mismatched project, or as someone else are rejected.
do $$
declare blocked boolean;
begin
  blocked := false;
  begin
    insert into project_facts (org_id, project_id, fact_key, value, provenance, created_by)
    values ('20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 'floor_area', '1', 'user_entered', auth.uid());
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: org A owner inserted a fact into org B'; end if;

  blocked := false;
  begin
    insert into project_facts (org_id, project_id, fact_key, value, provenance, created_by)
    values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000b', 'floor_area', '1', 'user_entered', auth.uid());
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a fact paired org A with org B''s project'; end if;

  blocked := false;
  begin
    insert into project_facts (org_id, project_id, fact_key, value, provenance, created_by)
    values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'floor_area', '1', 'user_entered',
            '10000000-0000-0000-0000-00000000000b');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: org A owner inserted a fact attributed to another user'; end if;

  blocked := false;
  begin
    insert into project_requirement_snapshots (org_id, project_id, outcome, explanation)
    values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'applicable', '{}');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a signed-in user inserted a requirement snapshot directly'; end if;

  blocked := false;
  begin
    insert into copilot_tool_invocations (org_id, user_id, trace_id, tool_name, arguments, status)
    values ('20000000-0000-0000-0000-00000000000a', auth.uid(), gen_random_uuid(), 'get_permit_requirements', '{}', 'succeeded');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a signed-in user inserted a tool invocation directly'; end if;

  raise notice 'PASS: cross-org, mismatched-project and forged-author facts, and direct snapshot/tool-call inserts, are rejected';
end $$;

-- A plain 'member' of org A cannot read tool invocations (elevated-role gate,
-- same as ai_jobs); the owner reading 1 above is the control.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c6","role":"authenticated"}';
do $$
declare n int; facts int;
begin
  select count(*) into n from copilot_tool_invocations where org_id = '20000000-0000-0000-0000-00000000000a';
  select count(*) into facts from project_facts where org_id = '20000000-0000-0000-0000-00000000000a';
  if facts <> 2 then
    raise exception 'FAIL (control): org A member should read org A facts (2), got %', facts;
  end if;
  if n <> 0 then
    raise exception 'FAIL: plain member read % org A tool invocation(s)', n;
  end if;
  raise notice 'PASS: plain member reads facts but not tool invocations (elevated roles only)';
end $$;

-- === 4. Append-only, both layers ===
-- Layer 1: no UPDATE/DELETE privilege for authenticated or service_role.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare
  t text;
  op text;
  blocked boolean;
begin
  foreach t in array array['source_revisions','source_revision_reviews','coverage_records','rule_set_versions',
                           'rule_set_version_items','fee_schedule_versions','project_facts',
                           'project_requirement_snapshots','copilot_tool_invocations'] loop
    foreach op in array array['update','delete'] loop
      blocked := false;
      begin
        if op = 'update' then
          execute format('update %I set id = id', t);
        else
          execute format('delete from %I', t);
        end if;
      exception when insufficient_privilege then blocked := true;
      end;
      if not blocked then
        raise exception 'FAIL: authenticated (platform admin) could % %', op, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS: authenticated has no UPDATE or DELETE privilege on any of the nine tables';
end $$;

set local role service_role;
do $$
declare
  t text;
  op text;
  blocked boolean;
begin
  foreach t in array array['source_revisions','source_revision_reviews','coverage_records','rule_set_versions',
                           'rule_set_version_items','fee_schedule_versions','project_facts',
                           'project_requirement_snapshots','copilot_tool_invocations'] loop
    foreach op in array array['update','delete'] loop
      blocked := false;
      begin
        if op = 'update' then
          execute format('update %I set id = id', t);
        else
          execute format('delete from %I', t);
        end if;
      exception when insufficient_privilege then blocked := true;
      end;
      if not blocked then
        raise exception 'FAIL: service_role could % %', op, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS: service_role has no UPDATE or DELETE privilege on any of the nine tables';
end $$;

-- Layer 2: a role WITH the privilege (postgres) is still stopped by the trigger.
reset role;
do $$
declare
  rec record;
  blocked boolean;
begin
  for rec in
    select * from (values
      ('source_revisions', 'c6000000-0000-0000-0000-000000000010'),
      ('source_revision_reviews', 'c6000000-0000-0000-0000-000000000011'),
      ('coverage_records', 'c6000000-0000-0000-0000-000000000012'),
      ('rule_set_versions', 'c6000000-0000-0000-0000-000000000013'),
      ('rule_set_version_items', 'c6000000-0000-0000-0000-000000000014'),
      ('fee_schedule_versions', 'c6000000-0000-0000-0000-000000000015'),
      ('project_facts', 'c6000000-0000-0000-0000-000000000020'),
      ('project_requirement_snapshots', 'c6000000-0000-0000-0000-000000000030'),
      ('copilot_tool_invocations', 'c6000000-0000-0000-0000-000000000040')
    ) v(tbl, row_id)
  loop
    blocked := false;
    begin
      execute format('update %I set id = id where id = %L', rec.tbl, rec.row_id);
    exception when raise_exception then
      if sqlerrm like '%append-only%' then blocked := true; else raise; end if;
    end;
    if not blocked then
      raise exception 'FAIL: postgres updated % row % without the append-only trigger firing', rec.tbl, rec.row_id;
    end if;

    blocked := false;
    begin
      execute format('delete from %I where id = %L', rec.tbl, rec.row_id);
    exception when raise_exception then
      if sqlerrm like '%append-only%' then blocked := true; else raise; end if;
    end;
    if not blocked then
      raise exception 'FAIL: postgres deleted % row % without the append-only trigger firing', rec.tbl, rec.row_id;
    end if;
  end loop;
  raise notice 'PASS: forbid_update_delete() stops UPDATE and DELETE of a real row on all nine tables, even for postgres';
end $$;

-- === 5. No TRUNCATE for anon / authenticated / service_role ===
do $$
declare
  t text;
  r text;
begin
  foreach t in array array['source_revisions','source_revision_reviews','coverage_records','rule_set_versions',
                           'rule_set_version_items','fee_schedule_versions','project_facts',
                           'project_requirement_snapshots','copilot_tool_invocations'] loop
    -- Control: the check sees real privileges (the owner holds TRUNCATE).
    if not has_table_privilege('postgres', t, 'TRUNCATE') then
      raise exception 'FAIL (control): postgres should hold TRUNCATE on %', t;
    end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r, t, 'TRUNCATE') then
        raise exception 'FAIL: % holds TRUNCATE on %', r, t;
      end if;
    end loop;
  end loop;
  raise notice 'PASS: anon, authenticated and service_role hold no TRUNCATE on any of the nine tables (owner does: control)';
end $$;

rollback;
