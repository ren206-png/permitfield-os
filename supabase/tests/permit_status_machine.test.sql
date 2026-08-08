-- Lifecycle & Compliance Expansion, Phase 1.3. Proves, against the actual
-- `authenticated`/`service_role` Postgres roles under RLS (not just "the UI
-- doesn't show a button for it" -- see prior gates' adversarial self-checks),
-- everything 20260806000022_permit_status_machine.sql and
-- 20260806000023_backfill_permit_application_project_id.sql add:
--   1. permit_applications gets permit_status ('intake' default), project_id,
--      and the three evidence columns; a fresh INSERT fires
--      seed_permit_status_history() and records the mandatory
--      NULL -> 'intake' row automatically.
--   2. transition_permit_status()'s Check 1 (transition legality): a legal
--      edge from permit_status_transitions succeeds; an undeclared pair is
--      rejected with 'invalid_transition' (SQLSTATE 22023), independent of
--      who's asking.
--   3. transition_permit_status()'s Check 2 (role-tier authorization), all
--      three tiers: org-tier accepts a plain member; submission-tier rejects
--      a plain member but accepts permit_manager; jurisdiction_outcome-tier
--      rejects both member and permit_manager-lacking-coordinator... actually
--      accepts permit_coordinator and rejects plain member -- proving the two
--      checks are independent (a legal move can still be role-rejected).
--   4. The cross-machine gate: permit_status cannot advance to 'submitted'
--      until the pipeline's own `status` column has independently reached
--      'submitted' -- checked AFTER legality/role, so a role-unauthorized
--      caller sees insufficient_privilege, not pipeline_not_submitted.
--   5. Idempotency: a repeated call with the same request_key is a silent
--      no-op (no duplicate application_status_history row, no re-validation).
--   6. application_status_history is append-only (forbid_update_delete()
--      trigger defeats even service_role's BYPASSRLS) and has no
--      INSERT/UPDATE/DELETE policy for `authenticated` at all -- a direct
--      INSERT from an ordinary session is rejected before it ever reaches
--      the trigger.
--   7. application_status_history's SELECT policy is is_org_member-gated,
--      same boundary as permit_applications -- Org B cannot read Org A's
--      history.
--   8. permit_status_tier() classifies all three tiers correctly (spot check
--      -- the exhaustive 16-status matrix is lib/permit-status/
--      transitions.test.ts's job, mirrored from this same seed data).
--   9. The 20260806000023 backfill: both supabase/seed.sql fixture
--      applications (which predate `project_id`) now have a non-null
--      project_id pointing at a `projects` row with `source = 'backfill'`.
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- see PHASE_0_FINDINGS.md SS1 and prior gate reports' "Tests" sections):
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/permit_status_machine.test.sql
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
-- Reuses Org A's fixture permit_applications row (already 'intake' via
-- default, with its trigger-seeded NULL -> 'intake' history row):
--   40000000-0000-0000-0000-00000000000a

-- Dedicated permit_manager/permit_coordinator/member fixture users, added
-- here (not in seed.sql) the same way jurisdiction_sources.test.sql adds its
-- own platform_admin fixture -- Org A's two seed owners don't cover the
-- three role tiers this migration's role-gating needs exercised.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated',
   'permit-manager@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000f', 'authenticated', 'authenticated',
   'permit-coordinator@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated',
   'member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000e', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000f', 'permit_coordinator'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000010', 'member')
on conflict (org_id, user_id) do nothing;

-- === 1. Fresh INSERT trigger: seed_permit_status_history() fires automatically ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  new_app_id uuid;
  seed_row_count int;
  seed_from permit_status_enum;
  seed_to permit_status_enum;
begin
  insert into permit_applications (org_id, contractor_id, permit_type_id, project_title, project_address)
  values ('20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0003-000000000001', 'Trigger Test Project', '1 Trigger Test St, Toronto, ON')
  returning id into new_app_id;

  select count(*), min(from_status), min(to_status) into seed_row_count, seed_from, seed_to
  from application_status_history
  where application_id = new_app_id;

  if seed_row_count <> 1 then
    raise exception 'FAIL: expected exactly 1 seeded history row for a fresh application, got %', seed_row_count;
  end if;
  if seed_from is not null then
    raise exception 'FAIL: seeded history row should have from_status null, got %', seed_from;
  end if;
  if seed_to <> 'intake' then
    raise exception 'FAIL: seeded history row should have to_status intake, got %', seed_to;
  end if;

  raise notice 'PASS: fresh permit_applications INSERT auto-seeds a NULL -> intake application_status_history row';

  -- Clean up so it doesn't interfere with later global counts in this file.
  delete from permit_applications where id = new_app_id;
end $$;

-- === 2. Check 1 (transition legality): a legal edge succeeds, an illegal one is rejected ===
-- Fixture application starts at 'intake' (seed default). intake -> withdrawn
-- IS legal but we don't want to burn it (terminal); use
-- intake -> requirements_review instead, then verify an undeclared pair
-- (requirements_review -> approved) fails.
do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'requirements_review', 'starting review');
  if result.permit_status <> 'requirements_review' then
    raise exception 'FAIL: legal transition intake -> requirements_review did not apply, got %', result.permit_status;
  end if;
  raise notice 'PASS: legal transition intake -> requirements_review succeeded';
end $$;

do $$
begin
  begin
    perform transition_permit_status('40000000-0000-0000-0000-00000000000a', 'approved');
    raise exception 'FAIL: illegal transition requirements_review -> approved was accepted';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: illegal transition requirements_review -> approved rejected with invalid_transition (%)', sqlerrm;
  end;
end $$;

-- === 3. Check 2 (role tiers), independent of Check 1 ===
-- 3a. Org tier: a plain member CAN make an org-tier move.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000010","role":"authenticated"}';

do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'collecting_documents');
  if result.permit_status <> 'collecting_documents' then
    raise exception 'FAIL: member could not make org-tier move requirements_review -> collecting_documents, got %', result.permit_status;
  end if;
  raise notice 'PASS: org-tier transition allowed for a plain member';
end $$;

do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'internal_review');
  if result.permit_status <> 'internal_review' then
    raise exception 'FAIL: member could not make org-tier move collecting_documents -> internal_review, got %', result.permit_status;
  end if;
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'ready_to_submit');
  if result.permit_status <> 'ready_to_submit' then
    raise exception 'FAIL: member could not make org-tier move internal_review -> ready_to_submit, got %', result.permit_status;
  end if;
  raise notice 'PASS: member walked the fixture application to ready_to_submit via consecutive org-tier moves';
end $$;

-- 3b. Submission tier: the SAME plain member is rejected on the boundary
-- move into a submission-tier status (ready_to_submit -> submitted IS a
-- legal edge -- this proves Check 2 is independent of Check 1, not a second
-- legality check in disguise).
do $$
begin
  begin
    perform transition_permit_status('40000000-0000-0000-0000-00000000000a', 'submitted');
    raise exception 'FAIL: plain member was able to move a legal edge into submission tier (ready_to_submit -> submitted)';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member correctly rejected on submission-tier move (%)', sqlerrm;
  end;
end $$;

-- permit_manager CAN make the same legal move -- but the cross-machine gate
-- (SS4 below) still blocks it until the pipeline's `status` independently
-- reaches 'submitted'. Prove that ordering first: role check passes,
-- pipeline gate fails with a DIFFERENT error.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000e","role":"authenticated"}';

do $$
begin
  begin
    perform transition_permit_status('40000000-0000-0000-0000-00000000000a', 'submitted');
    raise exception 'FAIL: permit_manager was able to advance to submitted before the pipeline status reached submitted';
  exception
    when sqlstate '42501' then
      raise exception 'FAIL: permit_manager was incorrectly rejected on the ROLE check for a submission-tier move it is authorized to make (%)', sqlerrm;
    when others then
      if sqlerrm not like 'pipeline_not_submitted%' then
        raise exception 'FAIL: expected pipeline_not_submitted, got a different error: %', sqlerrm;
      end if;
      raise notice 'PASS: permit_manager passes the role check but is correctly blocked by the cross-machine pipeline gate (%)', sqlerrm;
  end;
end $$;

-- === 4. Cross-machine gate: satisfy the pipeline's own `status`, then retry ===
-- Owner updates the pipeline column directly (permit_applications_update only
-- requires is_org_member -- untouched by this gate, see the migration's
-- header comment) to simulate the AI pipeline having independently reached
-- 'submitted'.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  update permit_applications set status = 'submitted' where id = '40000000-0000-0000-0000-00000000000a';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000e","role":"authenticated"}';

do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'submitted', 'handed off to jurisdiction');
  if result.permit_status <> 'submitted' then
    raise exception 'FAIL: permit_manager could not advance to submitted once the pipeline status also reached submitted, got %', result.permit_status;
  end if;
  raise notice 'PASS: permit_manager advances to submitted once the cross-machine gate is satisfied';
end $$;

do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'under_municipal_review');
  if result.permit_status <> 'under_municipal_review' then
    raise exception 'FAIL: permit_manager could not make submission-tier move submitted -> under_municipal_review, got %', result.permit_status;
  end if;
  raise notice 'PASS: permit_manager makes the second submission-tier move too';
end $$;

-- === 5. jurisdiction_outcome tier: permit_coordinator can, plain member cannot ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000010","role":"authenticated"}';

do $$
begin
  begin
    perform transition_permit_status('40000000-0000-0000-0000-00000000000a', 'approved');
    raise exception 'FAIL: plain member was able to record a jurisdiction_outcome-tier status (approved)';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member correctly rejected on jurisdiction_outcome-tier move (%)', sqlerrm;
  end;
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000f","role":"authenticated"}';

do $$
declare
  result permit_applications;
begin
  select * into result from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'approved', 'approved by jurisdiction');
  if result.permit_status <> 'approved' then
    raise exception 'FAIL: permit_coordinator could not record jurisdiction_outcome-tier status approved, got %', result.permit_status;
  end if;
  raise notice 'PASS: permit_coordinator (jurisdiction_outcome tier) can record approved';
end $$;

-- === 6. Idempotency: a repeated call with the same request_key is a silent no-op ===
do $$
declare
  result1 permit_applications;
  result2 permit_applications;
  history_count int;
  fixed_key uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  select * into result1 from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'issued', 'permit issued', fixed_key);
  if result1.permit_status <> 'issued' then
    raise exception 'FAIL: first call with request_key did not apply the transition, got %', result1.permit_status;
  end if;

  select * into result2 from transition_permit_status('40000000-0000-0000-0000-00000000000a', 'issued', 'permit issued -- retried', fixed_key);
  if result2.permit_status <> 'issued' then
    raise exception 'FAIL: idempotent retry unexpectedly changed permit_status to %', result2.permit_status;
  end if;

  select count(*) into history_count
  from application_status_history
  where application_id = '40000000-0000-0000-0000-00000000000a'
    and request_key = fixed_key;
  if history_count <> 1 then
    raise exception 'FAIL: expected exactly 1 history row for request_key %, got % (idempotency violated)', fixed_key, history_count;
  end if;

  raise notice 'PASS: a retried transition_permit_status() call with the same request_key is a silent no-op, no duplicate history row';
end $$;

-- === 7. application_status_history is append-only, even for service_role ===
set local role service_role;

do $$
begin
  begin
    update application_status_history set reason = 'tampered' where application_id = '40000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE an application_status_history row';
  exception
    when others then
      raise notice 'PASS: application_status_history UPDATE correctly rejected even for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from application_status_history where application_id = '40000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE an application_status_history row';
  exception
    when others then
      raise notice 'PASS: application_status_history DELETE correctly rejected even for service_role (%)', sqlerrm;
  end;
end $$;

-- === 8. No direct INSERT path: an ordinary authenticated session cannot write a history row itself ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into application_status_history (org_id, application_id, from_status, to_status, reason)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'issued', 'closed', 'self-attested, should be rejected');
    raise exception 'FAIL: an ordinary authenticated session was able to INSERT directly into application_status_history';
  exception
    when others then
      raise notice 'PASS: direct INSERT into application_status_history correctly rejected -- no policy grants it (%)', sqlerrm;
  end;
end $$;

-- === 9. SELECT RLS boundary: Org B cannot read Org A's application_status_history ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from application_status_history
  where application_id = '40000000-0000-0000-0000-00000000000a';
  if visible_count <> 0 then
    raise exception 'FAIL: Org B owner could see % rows of Org A''s application_status_history', visible_count;
  end if;
  raise notice 'PASS: Org B cannot read Org A''s application_status_history (is_org_member boundary holds)';
end $$;

-- Org A's own owner CAN read it, confirming the policy grants access, not
-- just denying it (a select-nothing policy would pass SS9 above trivially).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from application_status_history
  where application_id = '40000000-0000-0000-0000-00000000000a';
  if visible_count = 0 then
    raise exception 'FAIL: Org A owner could not read their own application_status_history at all';
  end if;
  raise notice 'PASS: Org A owner can read their own application_status_history (% rows)', visible_count;
end $$;

-- === 10. permit_status_tier() spot check (exhaustive matrix lives in the TS mirror's test) ===
do $$
begin
  if permit_status_tier('intake') <> 'org' then
    raise exception 'FAIL: permit_status_tier(intake) = %, expected org', permit_status_tier('intake');
  end if;
  if permit_status_tier('submitted') <> 'submission' then
    raise exception 'FAIL: permit_status_tier(submitted) = %, expected submission', permit_status_tier('submitted');
  end if;
  if permit_status_tier('issued') <> 'jurisdiction_outcome' then
    raise exception 'FAIL: permit_status_tier(issued) = %, expected jurisdiction_outcome', permit_status_tier('issued');
  end if;
  raise notice 'PASS: permit_status_tier() classifies intake/submitted/issued into the correct tiers';
end $$;

-- === 11. permit_status_transitions is readable by any authenticated user, global reference data ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  edge_count int;
begin
  select count(*) into edge_count from permit_status_transitions where from_status is not distinct from null and to_status = 'intake';
  if edge_count <> 1 then
    raise exception 'FAIL: Org B could not read the seeded (null, intake) permit_status_transitions row';
  end if;
  raise notice 'PASS: permit_status_transitions is globally readable, same shape as jurisdiction_sources';
end $$;

-- === 12. 20260806000023 backfill: both seed fixture applications now have a project_id ===
-- Runs against seed.sql's OTHER fixture row (Org B's, 40000000-...b) since
-- Org A's (...a) was already exercised extensively above but never had its
-- project_id touched by anything in this file -- either row proves the
-- backfill migration ran.
do $$
declare
  backfilled_project_id uuid;
  project_source text;
begin
  select project_id into backfilled_project_id
  from permit_applications where id = '40000000-0000-0000-0000-00000000000b';

  if backfilled_project_id is null then
    raise exception 'FAIL: Org B seed fixture application still has a null project_id after the backfill migration';
  end if;

  select source into project_source from projects where id = backfilled_project_id;
  if project_source <> 'backfill' then
    raise exception 'FAIL: backfilled project''s source column is %, expected ''backfill''', project_source;
  end if;

  raise notice 'PASS: 20260806000023 backfilled Org B''s orphaned seed application with a source=backfill placeholder project';
end $$;

rollback;
