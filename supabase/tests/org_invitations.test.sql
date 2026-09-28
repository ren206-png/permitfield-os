-- Team management / 20260806000074_org_invitations.sql.
-- Proves:
--   1. Only owners invite; existing members can't be invited; re-inviting
--      replaces the open invitation; sessions can no longer write
--      org_members directly.
--   2. Accepting needs the right token, an unexpired invitation, and the
--      invited email; it adds the member with the invited role, once.
--   3. Role changes and removals keep at least one owner.
--   4. The roster and invitations are visible only inside the org (and
--      invitations only to owners).

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'invitee@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'someone-else@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

create temporary table invite_ids (name text primary key, id uuid);
grant all on invite_ids to authenticated;

set local role authenticated;

-- Org A owner.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare
  v_first uuid;
  v_second uuid;
begin
  begin
    perform invite_org_member('20000000-0000-0000-0000-00000000000a', 'org-a-owner@example.test', 'member', repeat('0', 64));
    raise exception 'FAIL: invited someone who is already a member';
  exception
    when others then
      if sqlerrm not like 'already_member%' then raise; end if;
      raise notice 'PASS: existing members cannot be invited.';
  end;

  begin
    perform invite_org_member('20000000-0000-0000-0000-00000000000a', 'x@example.test', 'platform_admin', repeat('1', 64));
    raise exception 'FAIL: invited with a role owners may not give';
  exception
    when others then
      if sqlerrm not like 'invalid_role%' then raise; end if;
      raise notice 'PASS: only owner/permit_manager/permit_coordinator/member can be given.';
  end;

  v_first := invite_org_member('20000000-0000-0000-0000-00000000000a', ' Invitee@Test.PermitField.local ', 'member', repeat('a', 64));
  v_second := invite_org_member('20000000-0000-0000-0000-00000000000a', 'invitee@test.permitfield.local', 'permit_manager', repeat('b', 64));
  if (select revoked_at from org_invitations where id = v_first) is null then
    raise exception 'FAIL: re-inviting should revoke the earlier open invitation';
  end if;
  insert into invite_ids values ('open', v_second);
  raise notice 'PASS: owner invites (email normalized); a new invitation replaces the open one.';

  begin
    insert into org_members (org_id, user_id, role)
    values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c2', 'member');
    raise exception 'FAIL: owner inserted a member directly, without their consent';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: org_members can no longer be written directly (%)', sqlerrm;
  end;

  begin
    perform remove_org_member((select id from org_members where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a'));
    raise exception 'FAIL: removed the only owner';
  exception
    when others then
      if sqlerrm not like 'last_owner%' then raise; end if;
      raise notice 'PASS: the only owner cannot be removed.';
  end;
end $$;

-- Someone else, signed in with a different email, cannot use the link.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
do $$
begin
  perform accept_org_invitation(repeat('b', 64));
  raise exception 'FAIL: accepted an invitation sent to a different email';
exception
  when others then
    if sqlerrm not like 'email_mismatch%' then raise; end if;
    raise notice 'PASS: only the invited email can accept.';
end $$;

-- The invitee.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$
declare
  v_org uuid;
  v_role org_role;
begin
  begin
    perform accept_org_invitation(repeat('a', 64));
    raise exception 'FAIL: accepted a revoked invitation';
  exception
    when others then
      if sqlerrm not like 'invitation_unavailable%' then raise; end if;
      raise notice 'PASS: a replaced (revoked) invitation cannot be accepted.';
  end;

  v_org := accept_org_invitation(repeat('b', 64));
  select role into v_role from org_members where org_id = v_org and user_id = '10000000-0000-0000-0000-0000000000c1';
  if v_org <> '20000000-0000-0000-0000-00000000000a' or v_role <> 'permit_manager' then
    raise exception 'FAIL: accepting should add the invitee to org A as permit_manager (got %, %)', v_org, v_role;
  end if;
  if accept_org_invitation(repeat('b', 64)) <> v_org then
    raise exception 'FAIL: accepting twice should be a no-op for the same person';
  end if;
  raise notice 'PASS: the invitee joins with the invited role; accepting again is harmless.';

  begin
    perform update_org_member_role((select id from org_members where org_id = v_org and user_id = '10000000-0000-0000-0000-00000000000a'), 'member');
    raise exception 'FAIL: a permit manager changed a role';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: only owners change roles.';
  end;

  if (select count(*) from list_org_members(v_org) where email in ('org-a-owner@example.test', 'invitee@test.permitfield.local')) <> 2 then
    raise exception 'FAIL: the roster should list both members with their emails';
  end if;
  if (select count(*) from org_invitations) <> 0 then
    raise exception 'FAIL: a non-owner can read invitations';
  end if;
  raise notice 'PASS: members see the roster with emails; only owners see invitations.';
end $$;

-- Owner: promote the invitee, then step down; the org keeps an owner.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare
  v_owner_member uuid := (select id from org_members where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a');
  v_invitee_member uuid := (select id from org_members where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-0000000000c1');
begin
  begin
    perform update_org_member_role(v_owner_member, 'member');
    raise exception 'FAIL: the only owner demoted themselves';
  exception
    when others then
      if sqlerrm not like 'last_owner%' then raise; end if;
  end;
  perform update_org_member_role(v_invitee_member, 'owner');
  perform update_org_member_role(v_owner_member, 'member');
  if (select count(*) from org_members where org_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner') <> 1 then
    raise exception 'FAIL: expected exactly one owner after the handover';
  end if;
  raise notice 'PASS: ownership can be handed over, never left empty.';
end $$;

-- Org B owner sees nothing of org A's team.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
begin
  if (select count(*) from org_invitations where org_id = '20000000-0000-0000-0000-00000000000a') <> 0 then
    raise exception 'FAIL (tenant isolation): org B sees org A invitations';
  end if;
  begin
    perform list_org_members('20000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL (tenant isolation): org B listed org A members';
  exception
    when sqlstate '42501' then null;
  end;
  begin
    perform invite_org_member('20000000-0000-0000-0000-00000000000a', 'mallory@example.test', 'owner', repeat('c', 64));
    raise exception 'FAIL (tenant isolation): org B invited into org A';
  exception
    when sqlstate '42501' then null;
  end;
  raise notice 'PASS (tenant isolation): org B cannot see or change org A''s team.';
end $$;

reset role;

-- Expired invitations cannot be accepted.
insert into org_invitations (org_id, email, role, token_hash, invited_by, expires_at)
values ('20000000-0000-0000-0000-00000000000b', 'someone-else@test.permitfield.local', 'member', repeat('d', 64),
        '10000000-0000-0000-0000-00000000000b', now() - interval '1 minute');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
do $$
begin
  perform accept_org_invitation(repeat('d', 64));
  raise exception 'FAIL: accepted an expired invitation';
exception
  when others then
    if sqlerrm not like 'invitation_expired%' then raise; end if;
    raise notice 'PASS: expired invitations cannot be accepted.';
end $$;

reset role;

rollback;
