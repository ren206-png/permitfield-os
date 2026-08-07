-- Tenant root (3.1) and membership (3.2). org_members was missing from the original
-- draft spec; without it, no RLS policy anywhere in this schema can be written, since
-- every tenant-scoped policy below resolves "which orgs can this user see" through it.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create type org_role as enum ('owner', 'member');

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table organizations enable row level security;
alter table org_members enable row level security;

-- Helper functions, reused by every tenant-scoped policy in later migrations.
-- SECURITY DEFINER + owned by the migration role (postgres, which bypasses RLS in
-- Supabase) lets these query org_members without recursing into org_members' own
-- RLS policies -- the standard pattern for avoiding self-referential policy recursion.

create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

create or replace function is_org_owner(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function is_org_member(uuid) from public;
revoke all on function is_org_owner(uuid) from public;
grant execute on function is_org_member(uuid) to authenticated;
grant execute on function is_org_owner(uuid) to authenticated;

-- Bootstrapping: a bare INSERT policy on organizations/org_members can't express
-- "let a user create an org AND become its first owner in one step" without a
-- window where the org exists with zero owners. This RPC does both inserts under
-- one security-definer call (again bypassing RLS via the postgres owner role) so
-- there is no such window, and it is the ONLY sanctioned way to create an org --
-- there is no direct INSERT policy on organizations.
create or replace function create_organization_with_owner(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role) values (new_org_id, auth.uid(), 'owner');
  return new_org_id;
end;
$$;

revoke all on function create_organization_with_owner(text) from public;
grant execute on function create_organization_with_owner(text) to authenticated;

-- organizations: members can read/rename; nobody gets a direct INSERT policy (see above).
create policy organizations_select on organizations
  for select to authenticated
  using (is_org_member(id));

create policy organizations_update on organizations
  for update to authenticated
  using (is_org_owner(id))
  with check (is_org_owner(id));

-- org_members: members can see their org roster; only owners can add/change/remove members.
create policy org_members_select on org_members
  for select to authenticated
  using (is_org_member(org_id));

create policy org_members_insert on org_members
  for insert to authenticated
  with check (is_org_owner(org_id));

create policy org_members_update on org_members
  for update to authenticated
  using (is_org_owner(org_id))
  with check (is_org_owner(org_id));

create policy org_members_delete on org_members
  for delete to authenticated
  using (is_org_owner(org_id));
