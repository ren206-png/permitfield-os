-- Gate 2.0 sub-phase 2.4 pre-bridge grants
-- (20260806000032_bridge_read_grants.sql, GATE_2_0_SPEC.md §3, reviewed in
-- GATE_2_0_FINDINGS.md §K.1). Proves each of the three new
-- `grant select on <table> to service_role;` statements closes the gap
-- (service_role could not SELECT before it).
--
-- Control-then-assert, inverted shape -- same reasoning as
-- application_documents_service_role_insert.test.sql (20260806000031):
-- this is three new capabilities being added, not restrictions, so each
-- one gets (a) control -- with the grant explicitly revoked, confirm the
-- SELECT actually fails with permission denied; (b) assert -- with the
-- grant restored, the identical SELECT succeeds and returns the expected
-- row.
--
-- Does NOT assert service_role lacks INSERT/UPDATE/DELETE on these tables
-- -- see SERVICE_ROLE_GRANTS_FINDINGS.md SS2: on this platform,
-- service_role holds the full privilege set on every public-schema table
-- by default, independent of what this repo's own migrations grant.
-- Table-level GRANT/REVOKE was never the enforcement boundary for
-- service_role here; a prior version of this file asserted otherwise and
-- failed CI permanently as a result once verified live. The real
-- boundary (service_role's key never reaching untrusted code) is audited
-- separately, not by a SQL privilege check.
--
-- Runs as the connecting role (postgres, local superuser and owner of all
-- three tables) to perform the REVOKE/GRANT DDL, then SET ROLE
-- service_role for each SELECT/INSERT attempt -- identical pattern to
-- audit_logs_external_actor.test.sql and
-- application_documents_service_role_insert.test.sql.
--
-- Fixtures: organizations and application_status_history both already
-- carry rows this file can select without inserting anything itself --
-- Org A (id 20000000-0000-0000-0000-00000000000a, supabase/seed.sql PART
-- 2) and the 'intake' application_status_history row
-- permit_applications_seed_status_history auto-seeds for Org A's
-- permit_applications fixture (id 40000000-0000-0000-0000-00000000000a),
-- the same auto-seeded row permit_status_machine.test.sql section 1
-- already depends on. readiness_checklist_items has zero seed.sql
-- fixture rows (20260806000025 adds no seed data), so this file inserts
-- one control row itself, as the connecting owner role -- not as
-- service_role, which this migration deliberately never grants INSERT to.
--
-- Whole file wrapped in begin/rollback: GRANT/REVOKE, SET ROLE, and the
-- readiness_checklist_items control INSERT are all
-- transactional/session-scoped and fully undone by ROLLBACK. None of the
-- three tables carries a forbid_update_delete() trigger that would block
-- the owner's own cleanup (organizations/readiness_checklist_items have
-- no such trigger; application_status_history's trigger blocks
-- UPDATE/DELETE for every role but this file never updates or deletes an
-- existing row on it, only inserts-then-rolls-back on
-- readiness_checklist_items), so no savepoint trick is needed.

begin;

-- Step 1: explicitly revoke all three grants this migration adds, so the
-- control step below starts from an unambiguous "gap is present" state
-- rather than assuming it -- matches this migration's three statements
-- exactly, run in reverse.
revoke select on organizations from service_role;
revoke select on application_status_history from service_role;
revoke select on readiness_checklist_items from service_role;

-- Step 2: insert the readiness_checklist_items control row as the owning
-- role, before service_role is ever granted anything on this table --
-- service_role never gets INSERT here (SELECT-only migration), so this
-- row can only ever come from a different writer, exactly as it will in
-- production (the RLS-gated `authenticated` insert policy, not the
-- bridge layer).
insert into readiness_checklist_items (id, org_id, application_id, title, is_required, status)
values ('60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
        '40000000-0000-0000-0000-00000000000a', 'Site plan approved', true, 'pending');

-- Step 3 (control): as service_role, with all three grants absent, each
-- SELECT fails with permission denied -- proving the §K.1 gap was real
-- and reachable, not merely asserted from reading a grants file.
set role service_role;

do $$
begin
  perform 1 from organizations where id = '20000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL (control): service_role SELECT succeeded on organizations without the select grant -- the later success assertion would prove nothing without this control';
exception
  when insufficient_privilege then
    raise notice 'PASS (control): service_role SELECT on organizations correctly rejected (permission denied) before the grant is applied. (%)', sqlerrm;
end $$;

do $$
begin
  perform 1 from application_status_history where application_id = '40000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL (control): service_role SELECT succeeded on application_status_history without the select grant';
exception
  when insufficient_privilege then
    raise notice 'PASS (control): service_role SELECT on application_status_history correctly rejected (permission denied) before the grant is applied. (%)', sqlerrm;
end $$;

do $$
begin
  perform 1 from readiness_checklist_items where application_id = '40000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL (control): service_role SELECT succeeded on readiness_checklist_items without the select grant';
exception
  when insufficient_privilege then
    raise notice 'PASS (control): service_role SELECT on readiness_checklist_items correctly rejected (permission denied) before the grant is applied. (%)', sqlerrm;
end $$;

reset role;

-- Step 4: restore all three grants exactly as the migration defines them.
grant select on organizations to service_role;
grant select on application_status_history to service_role;
grant select on readiness_checklist_items to service_role;

-- Step 5 (assert): the identical SELECTs now succeed, returning the exact
-- column shapes §3/§K.1's migration header cites for each operation.
set role service_role;

do $$
declare
  v_name text;
begin
  -- resolveToken's orgName.
  select name into v_name from organizations where id = '20000000-0000-0000-0000-00000000000a';

  if v_name is null then
    raise exception 'FAIL (assert): service_role SELECT (name) on organizations returned no row';
  end if;
  raise notice 'PASS (assert): service_role SELECT (name) on organizations succeeds once the grant is restored (name=%).', v_name;
end $$;

do $$
declare
  v_to_status permit_status_enum;
  v_created_at timestamptz;
begin
  -- getApplicationSummary's statusHistory (to_status, created_at -- §K.1's
  -- migration header notes this as occurred_at in GATE_2_0_SPEC.md §3's own
  -- prose, but the actual column on this table is created_at; the test
  -- selects the real column, not the spec's prose name).
  select to_status, created_at into v_to_status, v_created_at
  from application_status_history
  where application_id = '40000000-0000-0000-0000-00000000000a'
  order by created_at asc
  limit 1;

  if v_to_status is null then
    raise exception 'FAIL (assert): service_role SELECT (to_status, created_at) on application_status_history returned no row';
  end if;
  raise notice 'PASS (assert): service_role SELECT (to_status, created_at) on application_status_history succeeds once the grant is restored (to_status=%, created_at=%).', v_to_status, v_created_at;
end $$;

do $$
declare
  v_title text;
  v_is_required boolean;
  v_status readiness_item_status;
begin
  -- getReadinessChecklist's { title, isRequired, status }.
  select title, is_required, status into v_title, v_is_required, v_status
  from readiness_checklist_items
  where id = '60000000-0000-0000-0000-00000000000a';

  if v_title is null then
    raise exception 'FAIL (assert): service_role SELECT (title, is_required, status) on readiness_checklist_items returned no row';
  end if;
  raise notice 'PASS (assert): service_role SELECT (title, is_required, status) on readiness_checklist_items succeeds once the grant is restored (title=%, is_required=%, status=%).', v_title, v_is_required, v_status;
end $$;

-- Step 6 intentionally omitted: this file previously asserted service_role
-- cannot INSERT into these tables. That assertion is false on this
-- platform regardless of what this migration grants -- see
-- SERVICE_ROLE_GRANTS_FINDINGS.md. Removed rather than left failing.

reset role;

rollback;
