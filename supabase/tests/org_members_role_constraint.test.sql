-- Proves the org_members_role_not_client_user CHECK constraint
-- (20260806000029_org_members_role_not_client_user.sql) actually blocks
-- role = 'client_user', not just an assertion that happens to pass for an
-- unrelated reason.
--
-- Same control-then-assert discipline used to fix tenant_isolation.test.sql's
-- application_documents block (GATE_2_0_FINDINGS.md SS E.3): a bare "this
-- insert fails" assertion alone would pass identically if Postgres rejected
-- it for a completely different reason (bad FK, a NOT NULL violation, the
-- connecting role lacking a grant, or `client_user` not even being a legal
-- org_role label to begin with), so this proves two things: (1) the
-- identical insert succeeds when this specific constraint doesn't exist
-- (control -- the constraint is dropped and later restored inside this
-- test's own transaction, so nothing persists past the final rollback),
-- and (2) it fails specifically via this named constraint once restored,
-- not via check_violation in general.
--
-- Runs as the connecting role for this session (postgres, the local
-- superuser -- the same role that owns org_members, since migrations apply
-- as postgres too), which is why it can ALTER TABLE here. service_role
-- itself is not granted any DDL privilege (20260806000011_grants.sql /
-- 20260806000015_service_role_grants.sql grant DML only), so this control
-- step has to run as the owning role -- that's consistent with the
-- constraint's own point (per the migration's comment): it holds against
-- service_role's DML too, once in place, even though service_role could
-- never drop it.

begin;

-- Step 1: drop the constraint so the control insert below has nothing
-- blocking it.
alter table org_members drop constraint org_members_role_not_client_user;

-- Step 2 (control): with the constraint absent, the same insert succeeds.
-- Uses a fresh org id (60000000-... -- the next unused id block after
-- seed.sql's 10000000/20000000/30000000/40000000/50000000 prefixes) rather
-- than reusing org A/B, and reuses org A's owner's already-seeded user_id
-- (org_members has `unique (org_id, user_id)`, so a fresh org_id avoids
-- colliding with the owner row seed.sql already inserted for that user).
do $$
declare
  control_count int;
begin
  insert into organizations (id, name)
  values ('60000000-0000-0000-0000-00000000000a', 'CHECK constraint control org (not a real org, rolled back)');

  insert into org_members (org_id, user_id, role)
  values ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'client_user');

  select count(*) into control_count
  from org_members
  where org_id = '60000000-0000-0000-0000-00000000000a' and role = 'client_user';
  if control_count <> 1 then
    raise exception 'FAIL (control): expected the client_user insert to succeed with org_members_role_not_client_user absent, got % rows -- the later rejection assertion would prove nothing without this control', control_count;
  end if;
  raise notice 'PASS (control): client_user insert succeeds with org_members_role_not_client_user absent (count=1) -- the later rejection is therefore the constraint actively blocking a real insert, not some unrelated failure.';

  -- Clear the control row before restoring the constraint below.
  delete from org_members where org_id = '60000000-0000-0000-0000-00000000000a';
end $$;

-- Step 3: restore the constraint exactly as the migration defines it.
alter table org_members
  add constraint org_members_role_not_client_user
  check (role <> 'client_user');

-- Step 4: the identical insert is now rejected, specifically by this
-- constraint (checked by name in the error text, not just "some
-- check_violation happened").
do $$
begin
  insert into org_members (org_id, user_id, role)
  values ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'client_user');
  raise exception 'FAIL: client_user insert succeeded even with org_members_role_not_client_user restored';
exception
  when check_violation then
    if sqlerrm not like '%org_members_role_not_client_user%' then
      raise exception 'FAIL: insert was rejected by a check_violation, but not by org_members_role_not_client_user specifically (got: %)', sqlerrm;
    end if;
    raise notice 'PASS: client_user insert rejected by org_members_role_not_client_user (%)', sqlerrm;
end $$;

rollback;
