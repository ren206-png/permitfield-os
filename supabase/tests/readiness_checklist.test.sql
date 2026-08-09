-- Lifecycle & Compliance Expansion, Gate 1.5. Proves, against the actual
-- `authenticated` Postgres role under RLS (not just "the UI doesn't show a
-- button for it" -- see prior gates' adversarial self-checks), everything
-- 20260806000025_readiness_checklist.sql adds:
--   1. Tenant isolation: Org B cannot read Org A's readiness_checklist_items
--      rows; Org A can read its own.
--   2. Role permission matrix on readiness_checklist_items: any org member
--      (plain `member`) can create/read/update a checklist item; only
--      `is_org_owner` can DELETE one (RLS silently filters the row out of a
--      non-owner's DELETE rather than raising -- 0 rows affected, row still
--      present).
--   3. compute_readiness_score()/readiness_checklist_complete() correctness
--      against a known set of required/optional/complete/incomplete rows,
--      including the 0-required-items vacuous case (100 / true).
--   4. Check 5: transition_permit_status() blocks internal_review ->
--      ready_to_submit while a required item is incomplete
--      (readiness_incomplete, 22023), and allows it once every required item
--      is complete.
--   5. The override path: an unauthorized role (plain member) is rejected
--      with insufficient_privilege (42501); an authorized role
--      (permit_manager) with too short a reason is rejected with
--      invalid_reason (22023); a valid call succeeds, stamps
--      permit_applications.readiness_override_*, writes an audit_logs row
--      (action = 'readiness_override'), and Check 5 subsequently allows
--      ready_to_submit even with the required item still incomplete.
--   6. Column-level lockout: a direct UPDATE of
--      permit_applications.readiness_override_at from `authenticated` is
--      rejected with insufficient_privilege (42501) before it ever reaches
--      RLS -- override_readiness_check() is the only write path left.
--
-- HOW TO RUN:
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/readiness_checklist.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh). Also runs automatically on every push/PR
-- via .github/workflows/ci.yml's sql-tests job.

begin;

-- Reuses Org A/B owner fixtures from supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b
-- Reuses Org A's fixture project (50000000-...a), contractor
-- (30000000-...a), and permit_type (00000000-0000-0000-0003-000000000001),
-- same as permit_status_machine.test.sql.

-- Dedicated permit_manager/member fixture users, added here (not in
-- seed.sql) the same way permit_status_machine.test.sql adds its own --
-- Org A's seed owner alone doesn't cover the role tiers this gate's role
-- gating needs exercised (plain member for the checklist-item matrix + the
-- override rejection path; permit_manager for the override success path).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000050', 'authenticated', 'authenticated',
   'readiness-permit-manager@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000051', 'authenticated', 'authenticated',
   'readiness-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000050', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000051', 'member')
on conflict (org_id, user_id) do nothing;

-- Fixture application #1 (SS1-3: tenant isolation, role matrix, scoring),
-- inserted directly at 'internal_review' -- seed_permit_status_history()
-- fires regardless (records NULL -> internal_review), this is fixture
-- setup, not a call through transition_permit_status().
insert into permit_applications (id, org_id, project_id, contractor_id, permit_type_id, project_title, project_address, permit_status)
values ('40000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
        '30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0003-000000000001',
        'Readiness Test Project 1', '1 Readiness Test St, Toronto, ON', 'internal_review');

-- Fixture application #2 (SS5: override path), same shape, separate row so
-- SS4's "mark the item complete and retry" doesn't interfere with SS5's
-- "leave the item incomplete and override instead" scenario.
insert into permit_applications (id, org_id, project_id, contractor_id, permit_type_id, project_title, project_address, permit_status)
values ('40000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
        '30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0003-000000000001',
        'Readiness Test Project 2', '2 Readiness Test St, Toronto, ON', 'internal_review');

-- === 1. Tenant isolation: Org B cannot read Org A's readiness_checklist_items ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  required_item_id uuid;
  optional_item_id uuid;
begin
  insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000015', 'Structural drawings', true, 'pending')
  returning id into required_item_id;

  insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000015', 'Site photos (optional)', false, 'pending')
  returning id into optional_item_id;

  if required_item_id is null or optional_item_id is null then
    raise exception 'FAIL: Org A owner could not insert readiness_checklist_items rows';
  end if;
  raise notice 'PASS: Org A owner created a required and an optional readiness_checklist_items row';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from readiness_checklist_items
  where application_id = '40000000-0000-0000-0000-000000000015';
  if visible_count <> 0 then
    raise exception 'FAIL: Org B owner could see % rows of Org A''s readiness_checklist_items', visible_count;
  end if;
  raise notice 'PASS: Org B cannot read Org A''s readiness_checklist_items (is_org_member boundary holds)';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from readiness_checklist_items
  where application_id = '40000000-0000-0000-0000-000000000015';
  if visible_count <> 2 then
    raise exception 'FAIL: Org A owner could not read its own readiness_checklist_items rows, saw %', visible_count;
  end if;
  raise notice 'PASS: Org A owner can read its own readiness_checklist_items (% rows)', visible_count;
end $$;

-- === 2. Role permission matrix: plain member can create/read/update, cannot delete ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000051","role":"authenticated"}';

do $$
declare
  member_item_id uuid;
  row_status readiness_item_status;
begin
  insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000015', 'Fire safety plan', true, 'pending')
  returning id into member_item_id;
  if member_item_id is null then
    raise exception 'FAIL: plain member could not INSERT a readiness_checklist_items row';
  end if;

  update readiness_checklist_items set status = 'complete' where id = member_item_id;
  select status into row_status from readiness_checklist_items where id = member_item_id;
  if row_status <> 'complete' then
    raise exception 'FAIL: plain member could not UPDATE a readiness_checklist_items row it created, status is %', row_status;
  end if;

  raise notice 'PASS: plain member (is_org_member) can create, read, and update readiness_checklist_items';

  -- DELETE: readiness_checklist_items_delete requires is_org_owner. RLS
  -- filters the target row out of a non-owner's DELETE rather than raising
  -- -- assert 0 rows affected and the row still present, not an exception.
  delete from readiness_checklist_items where id = member_item_id;
  if found then
    raise exception 'FAIL: plain member was able to DELETE a readiness_checklist_items row (is_org_owner-only policy did not hold)';
  end if;

  perform 1 from readiness_checklist_items where id = member_item_id;
  if not found then
    raise exception 'FAIL: readiness_checklist_items row disappeared after a DELETE that should have affected 0 rows';
  end if;
  raise notice 'PASS: plain member''s DELETE attempt affects 0 rows -- readiness_checklist_items_delete is is_org_owner-only';
end $$;

-- Org owner CAN delete the same row, confirming the policy grants access to
-- the right role, not just denying it to the wrong one. Claims switch is a
-- top-level SET, not something a plpgsql do-block body can execute directly
-- (SET/RESET aren't valid plpgsql statements) -- same reason every claims
-- switch in this file, and in permit_status_machine.test.sql, happens
-- between do $$ blocks rather than inside one.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  member_item_id uuid;
begin
  select id into member_item_id from readiness_checklist_items where title = 'Fire safety plan';

  delete from readiness_checklist_items where id = member_item_id;
  perform 1 from readiness_checklist_items where id = member_item_id;
  if found then
    raise exception 'FAIL: Org A owner (is_org_owner) could not DELETE a readiness_checklist_items row';
  end if;
  raise notice 'PASS: Org A owner (is_org_owner) can DELETE a readiness_checklist_items row';
end $$;

-- === 3. compute_readiness_score() / readiness_checklist_complete() ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  score numeric;
  complete boolean;
begin
  -- Current state on application #1: 1 required item (still 'pending', from
  -- SS1), 1 optional item (from SS1). SS2's item was deleted.
  select compute_readiness_score('40000000-0000-0000-0000-000000000015') into score;
  if score <> 0 then
    raise exception 'FAIL: expected 0%% readiness with the sole required item still pending, got %', score;
  end if;

  select readiness_checklist_complete('40000000-0000-0000-0000-000000000015') into complete;
  if complete then
    raise exception 'FAIL: readiness_checklist_complete() returned true while a required item is still pending';
  end if;
  raise notice 'PASS: compute_readiness_score() = 0, readiness_checklist_complete() = false, with 1 pending required item';

  -- Add a second required item, mark ONE of the two required items complete
  -- -- score should land at exactly 50%, still incomplete overall.
  insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000015', 'Structural engineer sign-off', true, 'complete');

  select compute_readiness_score('40000000-0000-0000-0000-000000000015') into score;
  if score <> 50 then
    raise exception 'FAIL: expected 50%% readiness with 1 of 2 required items complete, got %', score;
  end if;

  select readiness_checklist_complete('40000000-0000-0000-0000-000000000015') into complete;
  if complete then
    raise exception 'FAIL: readiness_checklist_complete() returned true with 1 of 2 required items still incomplete';
  end if;
  raise notice 'PASS: compute_readiness_score() = 50, readiness_checklist_complete() = false, with 1 of 2 required items complete';

  -- Complete the remaining required item -- 100%, and now complete.
  update readiness_checklist_items
  set status = 'complete'
  where application_id = '40000000-0000-0000-0000-000000000015' and is_required and status <> 'complete';

  select compute_readiness_score('40000000-0000-0000-0000-000000000015') into score;
  if score <> 100 then
    raise exception 'FAIL: expected 100%% readiness with every required item complete, got %', score;
  end if;

  select readiness_checklist_complete('40000000-0000-0000-0000-000000000015') into complete;
  if not complete then
    raise exception 'FAIL: readiness_checklist_complete() returned false with every required item complete';
  end if;
  raise notice 'PASS: compute_readiness_score() = 100, readiness_checklist_complete() = true, with every required item complete';
end $$;

-- 0-required-items vacuous case: a fresh application with only an optional
-- item (or none at all) is treated as 100 / complete.
do $$
declare
  score numeric;
  complete boolean;
begin
  select compute_readiness_score('40000000-0000-0000-0000-000000000016') into score;
  if score <> 100 then
    raise exception 'FAIL: expected 100%% readiness for an application with zero readiness_checklist_items rows, got %', score;
  end if;

  select readiness_checklist_complete('40000000-0000-0000-0000-000000000016') into complete;
  if not complete then
    raise exception 'FAIL: readiness_checklist_complete() returned false for an application with zero readiness_checklist_items rows';
  end if;
  raise notice 'PASS: compute_readiness_score() = 100 and readiness_checklist_complete() = true for the 0-required-items vacuous case';
end $$;

-- === 4. Check 5: transition_permit_status() gates internal_review -> ready_to_submit ===
-- Application #1 currently has 2 required items, both complete (end of
-- SS3) -- prove the HAPPY path first, then rebuild an incomplete state to
-- prove the BLOCKING path, so this section doesn't depend on SS3's ordering
-- to read cleanly on its own.
do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-000000000015', 'ready_to_submit', 'all readiness items complete');
  if result.permit_status <> 'ready_to_submit' then
    raise exception 'FAIL: transition to ready_to_submit did not apply with every required item complete, got %', result.permit_status;
  end if;
  raise notice 'PASS: internal_review -> ready_to_submit succeeds once every required readiness item is complete';
end $$;

do $$
declare
  new_item_id uuid;
begin
  -- Move back to internal_review isn't a legal edge (no such row in
  -- permit_status_transitions), so this section uses application #2
  -- instead -- still 'internal_review' (SS3's vacuous-case check only read
  -- it, never transitioned it) -- and gives it one incomplete required item.
  insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000016', 'Zoning variance letter', true, 'pending')
  returning id into new_item_id;

  begin
    perform transition_permit_status('40000000-0000-0000-0000-000000000016', 'ready_to_submit');
    raise exception 'FAIL: transition to ready_to_submit succeeded with a required readiness item still pending';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'readiness_incomplete%' then
        raise exception 'FAIL: expected readiness_incomplete, got a different 22023 error: %', sqlerrm;
      end if;
      raise notice 'PASS: internal_review -> ready_to_submit correctly blocked with readiness_incomplete while a required item is pending (%)', sqlerrm;
  end;
end $$;

-- === 5. Override path ===
-- 5a. Unauthorized role (plain member) is rejected with insufficient_privilege.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000051","role":"authenticated"}';

do $$
begin
  begin
    perform override_readiness_check('40000000-0000-0000-0000-000000000016', 'This override reason is long enough to pass the length check.');
    raise exception 'FAIL: plain member was able to call override_readiness_check()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member correctly rejected on override_readiness_check() with insufficient_privilege (%)', sqlerrm;
  end;
end $$;

-- 5b. Authorized role (permit_manager), reason too short.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000050","role":"authenticated"}';

do $$
begin
  begin
    perform override_readiness_check('40000000-0000-0000-0000-000000000016', 'too short');
    raise exception 'FAIL: override_readiness_check() accepted a reason under 20 characters';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'invalid_reason%' then
        raise exception 'FAIL: expected invalid_reason, got a different 22023 error: %', sqlerrm;
      end if;
      raise notice 'PASS: override_readiness_check() correctly rejected a too-short reason with invalid_reason (%)', sqlerrm;
  end;
end $$;

-- 5c. Authorized role, valid reason: succeeds, stamps the three columns,
-- writes an audit_logs row.
do $$
declare
  result permit_applications;
  audit_count int;
begin
  select * into result from override_readiness_check('40000000-0000-0000-0000-000000000016', 'Client committed to filing the zoning variance separately; proceeding without it.');

  if result.readiness_override_at is null or result.readiness_override_by is null or result.readiness_override_reason is null then
    raise exception 'FAIL: override_readiness_check() succeeded but left one of the three readiness_override_* columns null';
  end if;
  if result.readiness_override_by <> '10000000-0000-0000-0000-000000000050' then
    raise exception 'FAIL: readiness_override_by = %, expected the calling permit_manager''s user id', result.readiness_override_by;
  end if;

  select count(*) into audit_count
  from audit_logs
  where entity_type = 'permit_application'
    and entity_id = '40000000-0000-0000-0000-000000000016'
    and action = 'readiness_override';
  if audit_count <> 1 then
    raise exception 'FAIL: expected exactly 1 audit_logs row for this override, found %', audit_count;
  end if;

  raise notice 'PASS: override_readiness_check() succeeds for permit_manager, stamps readiness_override_*, writes 1 audit_logs row';
end $$;

-- 5d. Check 5 now allows ready_to_submit despite the required item still
-- being 'pending' -- the override, not the checklist, is what satisfies it.
do $$
declare
  result permit_applications;
  item_status readiness_item_status;
begin
  select status into item_status from readiness_checklist_items
  where application_id = '40000000-0000-0000-0000-000000000016' and title = 'Zoning variance letter';
  if item_status <> 'pending' then
    raise exception 'FAIL: test setup assumption violated -- expected the zoning variance item to still be pending, got %', item_status;
  end if;

  select * into result from transition_permit_status('40000000-0000-0000-0000-000000000016', 'ready_to_submit', 'proceeding under readiness override');
  if result.permit_status <> 'ready_to_submit' then
    raise exception 'FAIL: transition to ready_to_submit did not apply after a recorded readiness override, got %', result.permit_status;
  end if;
  raise notice 'PASS: internal_review -> ready_to_submit succeeds under a recorded readiness override, even with a required item still pending';
end $$;

-- === 6. Column-level lockout: direct UPDATE of readiness_override_at is rejected ===
-- Probed as the Org A owner specifically to show this isn't just "member
-- lacks privilege" -- even the role that can call override_readiness_check()
-- indirectly (owner is in that role list) has NO direct column privilege;
-- override_readiness_check() (SECURITY DEFINER) is the only write path.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    update permit_applications set readiness_override_at = now() where id = '40000000-0000-0000-0000-000000000015';
    raise exception 'FAIL: Org A owner was able to directly UPDATE readiness_override_at, bypassing override_readiness_check()';
  exception
    when insufficient_privilege then
      raise notice 'PASS: direct UPDATE of readiness_override_at correctly rejected with insufficient_privilege (%)', sqlerrm;
    when others then
      raise exception 'FAIL: direct UPDATE of readiness_override_at was rejected, but with the wrong error (expected insufficient_privilege / 42501): % (%)', sqlerrm, sqlstate;
  end;
end $$;

rollback;
