-- Team management: invite people to an organization, change their role,
-- remove them. Additive, plus one tightening.
--
-- 1. org_invitations: an emailed invitation to join an org with a role. The
--    link carries a random token; only its sha256 is stored. Accepting
--    requires signing in as the invited email address.
-- 2. Every membership change now goes through the functions below, and
--    session roles lose direct INSERT/UPDATE/DELETE on org_members. Before
--    this, the owner-only RLS policies let an owner insert ANY user id into
--    their org (no consent from that user), and nothing stopped the last
--    owner from demoting or removing themselves. The functions add the
--    consent step (the invitee accepts) and keep at least one owner.
-- 3. list_org_members(): the roster with each member's email, which sessions
--    can't read from auth.users themselves.
--
-- Roles an owner can give: owner, permit_manager, permit_coordinator,
-- member -- the ones the database actually treats differently today
-- (is_org_owner() is the literal 'owner'; permit_manager and
-- permit_coordinator are the submission / jurisdiction-outcome tiers of
-- transition_permit_status() and friends). The other org_role values have
-- no distinct enforcement yet (lib/authz's header comment), so offering
-- them would promise permissions that don't exist.

create table org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  role org_role not null check (role in ('owner', 'permit_manager', 'permit_coordinator', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or revoked_at is null)
);

create unique index org_invitations_one_open_per_email
  on org_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;
create index org_invitations_org_idx on org_invitations (org_id, created_at desc);

alter table org_invitations enable row level security;

create policy org_invitations_select on org_invitations
  for select to authenticated
  using (is_org_owner(org_id));

revoke all on org_invitations from anon, authenticated;
grant select on org_invitations to authenticated;
revoke truncate on org_invitations from service_role;
grant select on org_invitations to service_role;

-- Memberships change only through the functions below (and
-- create_organization_with_owner() for an org's first owner).
revoke insert, update, delete on org_members from authenticated;

create or replace function list_org_members(p_org_id uuid)
returns table (member_id uuid, user_id uuid, email text, role org_role, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'not_authorized: not a member of this organization' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text, m.role, m.created_at
    from org_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
    order by m.created_at;
end;
$$;

create or replace function invite_org_member(p_org_id uuid, p_email text, p_role org_role, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not is_org_owner(p_org_id) then
    raise exception 'not_authorized: only owners can invite people' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'permit_manager', 'permit_coordinator', 'member') then
    raise exception 'invalid_role: % cannot be given by invitation', p_role;
  end if;
  if exists (
    select 1 from org_members m join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id and lower(u.email) = v_email
  ) then
    raise exception 'already_member: % is already in this organization', v_email;
  end if;

  update org_invitations set revoked_at = now()
  where org_id = p_org_id and email = v_email and accepted_at is null and revoked_at is null;

  insert into org_invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (p_org_id, v_email, p_role, p_token_hash, auth.uid(), now() + interval '7 days')
  returning id into v_id;

  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  select p_org_id, auth.uid(), m.role, 'org_member.invited', 'org_invitation', v_id,
         jsonb_build_object('email', v_email, 'role', p_role)
  from org_members m where m.org_id = p_org_id and m.user_id = auth.uid();

  return v_id;
end;
$$;

create or replace function revoke_org_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from org_invitations where id = p_invitation_id;
  if v_org_id is null or not is_org_owner(v_org_id) then
    raise exception 'not_authorized: only owners can revoke invitations' using errcode = '42501';
  end if;
  update org_invitations set revoked_at = now()
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'not_open: this invitation was already accepted or revoked';
  end if;
end;
$$;

-- The signed-in caller accepts with the token from their link. Their account
-- email must be the invited address, so a forwarded link can't be used by
-- someone else.
create or replace function accept_org_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite org_invitations%rowtype;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_invite from org_invitations where token_hash = p_token_hash for update;
  if v_invite.id is null or v_invite.revoked_at is not null then
    raise exception 'invitation_unavailable: this invitation is no longer valid';
  end if;
  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = auth.uid() then
      return v_invite.org_id;
    end if;
    raise exception 'invitation_unavailable: this invitation has already been used';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invitation_expired: this invitation has expired';
  end if;

  select lower(email) into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is distinct from v_invite.email then
    raise exception 'email_mismatch: sign in as % to accept this invitation', v_invite.email;
  end if;

  insert into org_members (org_id, user_id, role)
  values (v_invite.org_id, auth.uid(), v_invite.role)
  on conflict (org_id, user_id) do nothing;

  update org_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_invite.id;

  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  values (v_invite.org_id, auth.uid(), v_invite.role, 'org_member.joined', 'org_invitation', v_invite.id,
          jsonb_build_object('email', v_invite.email, 'role', v_invite.role));

  return v_invite.org_id;
end;
$$;

create or replace function update_org_member_role(p_member_id uuid, p_role org_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member org_members%rowtype;
  v_actor_role org_role;
begin
  select * into v_member from org_members where id = p_member_id for update;
  if v_member.id is null or not is_org_owner(v_member.org_id) then
    raise exception 'not_authorized: only owners can change roles' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'permit_manager', 'permit_coordinator', 'member') then
    raise exception 'invalid_role: % cannot be assigned here', p_role;
  end if;
  if v_member.role = 'owner' and p_role <> 'owner' and not exists (
    select 1 from org_members where org_id = v_member.org_id and role = 'owner' and id <> v_member.id
  ) then
    raise exception 'last_owner: the organization needs at least one owner';
  end if;

  update org_members set role = p_role where id = p_member_id;

  select role into v_actor_role from org_members where org_id = v_member.org_id and user_id = auth.uid();
  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, before_summary, after_summary)
  values (v_member.org_id, auth.uid(), coalesce(v_actor_role, 'owner'), 'org_member.role_changed', 'org_member', v_member.id,
          jsonb_build_object('role', v_member.role), jsonb_build_object('role', p_role));
end;
$$;

create or replace function remove_org_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member org_members%rowtype;
  v_actor_role org_role;
begin
  select * into v_member from org_members where id = p_member_id for update;
  if v_member.id is null or not is_org_owner(v_member.org_id) then
    raise exception 'not_authorized: only owners can remove people' using errcode = '42501';
  end if;
  if v_member.role = 'owner' and not exists (
    select 1 from org_members where org_id = v_member.org_id and role = 'owner' and id <> v_member.id
  ) then
    raise exception 'last_owner: the organization needs at least one owner';
  end if;

  select role into v_actor_role from org_members where org_id = v_member.org_id and user_id = auth.uid();
  delete from org_members where id = p_member_id;

  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, before_summary)
  values (v_member.org_id, auth.uid(), coalesce(v_actor_role, 'owner'), 'org_member.removed', 'org_member', v_member.id,
          jsonb_build_object('user_id', v_member.user_id, 'role', v_member.role));
end;
$$;

-- Platform defaults grant EXECUTE to anon and authenticated directly
-- (20260806000071); revoke them by name.
revoke all on function list_org_members(uuid) from public, anon;
revoke all on function invite_org_member(uuid, text, org_role, text) from public, anon;
revoke all on function revoke_org_invitation(uuid) from public, anon;
revoke all on function accept_org_invitation(text) from public, anon;
revoke all on function update_org_member_role(uuid, org_role) from public, anon;
revoke all on function remove_org_member(uuid) from public, anon;
grant execute on function list_org_members(uuid) to authenticated;
grant execute on function invite_org_member(uuid, text, org_role, text) to authenticated;
grant execute on function revoke_org_invitation(uuid) to authenticated;
grant execute on function accept_org_invitation(text) to authenticated;
grant execute on function update_org_member_role(uuid, org_role) to authenticated;
grant execute on function remove_org_member(uuid) to authenticated;
