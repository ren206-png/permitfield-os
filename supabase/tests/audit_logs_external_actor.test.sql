-- Gate 2.0 sub-phase 2.2 (20260806000030_audit_logs_external_actor.sql,
-- GATE_2_0_SPEC.md §4/§6, reviewed in GATE_2_0_FINDINGS.md §I). Proves the
-- audit_logs_actor_exactly_one_populated CHECK actually enforces "internal
-- actor xor external actor, never neither, never both" -- not folded into
-- audit_logs.test.sql (Phase 1.0's file, scoped to RLS/append-only/tenant
-- isolation) because this is a single added constraint on an otherwise
-- unrelated axis, same one-file-per-added-constraint shape as
-- org_members_role_constraint.test.sql.
--
-- Same control-then-assert discipline as that file and as
-- GATE_2_0_SPEC.md §6 literally specifies for this sub-phase: (a) with the
-- constraint dropped, prove BOTH illegal shapes ("neither actor populated"
-- and "both actor kinds populated at once") are reachable at all -- a bare
-- "insert fails" assertion later would prove nothing without this control.
-- (b) restore the constraint, prove both are now rejected specifically by
-- audit_logs_actor_exactly_one_populated, not just any check_violation.
-- (c) confirm a normal, unchanged internal-actor insert still succeeds --
-- the regression check proving this migration didn't silently break the
-- only path every existing audit_logs writer already uses.
--
-- Runs as the connecting role for this session (postgres, the local
-- superuser and the table owner), same reasoning as
-- org_members_role_constraint.test.sql: only the owning role can
-- ALTER TABLE ... DROP/ADD CONSTRAINT here, and service_role is never
-- granted DDL on this table either way.
--
-- Reuses supabase/seed.sql PART 2's Org A fixture (org
-- 20000000-0000-0000-0000-00000000000a, owner user
-- 10000000-0000-0000-0000-00000000000a), the same fixture
-- audit_logs.test.sql and tenant_isolation.test.sql already rely on --
-- org_id/actor_user_id are FK-enforced (organizations(id)/auth.users(id)),
-- so this file cannot invent arbitrary ids for either column.

begin;

-- Step 1: drop the constraint so the control inserts below have nothing
-- blocking them.
alter table audit_logs drop constraint audit_logs_actor_exactly_one_populated;

-- Step 2 (control): with the constraint absent, both illegal shapes
-- succeed -- proving the later rejection is the constraint actively
-- blocking a reachable state, not some unrelated failure.
do $$
declare
  control_count int;
begin
  -- Illegal shape 1: neither actor populated (actor_user_id/actor_role AND
  -- external_actor_id all null).
  insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, external_actor_id)
  values ('51000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
          null, null, 'test.control_neither_actor', 'permit_applications', null);

  -- Illegal shape 2: both actor kinds populated at once.
  insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, external_actor_id)
  values ('51000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000a',
          '10000000-0000-0000-0000-00000000000a', 'owner', 'test.control_both_actors', 'permit_applications',
          'client_access_tokens:test-token-id');

  select count(*) into control_count
  from audit_logs
  where id in ('51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000b');
  if control_count <> 2 then
    raise exception 'FAIL (control): expected both illegal-shape rows to insert with audit_logs_actor_exactly_one_populated absent, got % -- the later rejection assertions would prove nothing without this control', control_count;
  end if;
  raise notice 'PASS (control): both "neither actor" and "both actors" rows insert successfully with audit_logs_actor_exactly_one_populated absent (count=2).';

  -- Clear the control rows before restoring the constraint.
  delete from audit_logs where id in ('51000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000b');
end $$;

-- Step 3: restore the constraint exactly as the migration defines it.
alter table audit_logs add constraint audit_logs_actor_exactly_one_populated
  check (
    (actor_user_id is not null and actor_role is not null and external_actor_id is null)
    or
    (actor_user_id is null and actor_role is null and external_actor_id is not null)
  );

-- Step 4 (assert): both identical inserts are now rejected, specifically by
-- this constraint (checked by name in the error text).
do $$
begin
  insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, external_actor_id)
  values ('51000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
          null, null, 'test.assert_neither_actor', 'permit_applications', null);
  raise exception 'FAIL: "neither actor populated" insert succeeded even with audit_logs_actor_exactly_one_populated restored';
exception
  when check_violation then
    if sqlerrm not like '%audit_logs_actor_exactly_one_populated%' then
      raise exception 'FAIL: "neither actor" insert was rejected by a check_violation, but not by audit_logs_actor_exactly_one_populated specifically (got: %)', sqlerrm;
    end if;
    raise notice 'PASS: "neither actor populated" insert rejected by audit_logs_actor_exactly_one_populated (%)', sqlerrm;
end $$;

do $$
begin
  insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, external_actor_id)
  values ('51000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000a',
          '10000000-0000-0000-0000-00000000000a', 'owner', 'test.assert_both_actors', 'permit_applications',
          'client_access_tokens:test-token-id');
  raise exception 'FAIL: "both actors populated" insert succeeded even with audit_logs_actor_exactly_one_populated restored';
exception
  when check_violation then
    if sqlerrm not like '%audit_logs_actor_exactly_one_populated%' then
      raise exception 'FAIL: "both actors" insert was rejected by a check_violation, but not by audit_logs_actor_exactly_one_populated specifically (got: %)', sqlerrm;
    end if;
    raise notice 'PASS: "both actors populated" insert rejected by audit_logs_actor_exactly_one_populated (%)', sqlerrm;
end $$;

-- Step 5 (regression): a normal, unchanged internal-actor insert -- the
-- only shape every existing writer (audit_logs_insert policy,
-- override_readiness_check(), review_project_permit_requirement()) has
-- ever used -- still succeeds exactly as before this migration.
do $$
declare
  v_count int;
begin
  insert into audit_logs (id, org_id, actor_user_id, actor_role, action, entity_type, entity_id)
  values ('51000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000a',
          '10000000-0000-0000-0000-00000000000a', 'owner', 'test.regression_internal_actor',
          'permit_applications', '40000000-0000-0000-0000-00000000000a');

  select count(*) into v_count from audit_logs where id = '51000000-0000-0000-0000-00000000000c';
  if v_count <> 1 then
    raise exception 'FAIL (regression): normal internal-actor insert (only actor_user_id/actor_role populated) did not persist after this migration (count=%)', v_count;
  end if;
  raise notice 'PASS (regression): normal internal-actor insert still succeeds unchanged after audit_logs_actor_exactly_one_populated (count=%).', v_count;
end $$;

-- Adjacent coverage, not in §6's literal list but the same constraint-
-- verification discipline: audit_logs_external_actor_label_requires_id
-- rejects a label with no id to attach to.
do $$
begin
  insert into audit_logs (id, org_id, action, entity_type, external_actor_id, external_actor_label)
  values ('51000000-0000-0000-0000-00000000000d', '20000000-0000-0000-0000-00000000000a',
          'test.label_without_id', 'permit_applications', null, 'Orphan Label, No Id');
  raise exception 'FAIL: external_actor_label without external_actor_id succeeded despite audit_logs_external_actor_label_requires_id';
exception
  when check_violation then
    if sqlerrm not like '%audit_logs_external_actor_label_requires_id%' then
      raise exception 'FAIL: label-without-id insert was rejected by a check_violation, but not by audit_logs_external_actor_label_requires_id specifically (got: %)', sqlerrm;
    end if;
    raise notice 'PASS: external_actor_label without external_actor_id rejected by audit_logs_external_actor_label_requires_id (%)', sqlerrm;
end $$;

rollback;
