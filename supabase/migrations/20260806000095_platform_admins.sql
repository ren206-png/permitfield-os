-- Gate 6, finding F4 (GATE_6_STATUS.md § 6.3): a platform admin without an
-- org role.
--
-- is_platform_admin() (20260806000021) recognised only an org_members row
-- with role 'platform_admin'. org_members.role is one value per (org, user),
-- so the only way to be a platform admin was to give up being an owner of
-- one's own org -- and production had no platform admin at all, so every
-- catalogue write behind is_platform_admin() (jurisdiction sources,
-- requirements, rule sets, source registry) was unusable.
--
-- This adds platform_admins: PermitField staff accounts, independent of any
-- org. is_platform_admin() becomes "org role platform_admin OR listed here";
-- the existing org-role path is unchanged, so this only widens it.
--
-- The table has no grants and no policies for anon, authenticated or
-- service_role: nobody can list it or add themselves through the API.
-- Rows are added and removed by the database owner (SQL), and the function
-- reads it as SECURITY DEFINER. What is_platform_admin() unlocks is the
-- shared catalogue only (see the policies in migrations 021, 026, 091,
-- 094); it grants no access to any org's projects or applications.
--
-- No account is listed by this migration (the repository is public).
--
-- Rollback (valid while no later object references platform_admins):
--   create or replace function is_platform_admin() returns boolean
--     language sql stable security definer set search_path = public
--     as $$ select exists (select 1 from org_members
--                          where user_id = auth.uid() and role = 'platform_admin'); $$;
--   drop table if exists platform_admins;

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text check (length(note) <= 500)
);

alter table platform_admins enable row level security;
revoke all on platform_admins from anon, authenticated, service_role;

-- CREATE OR REPLACE keeps the function's existing grants
-- (postgres + authenticated EXECUTE only).
create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where user_id = auth.uid() and role = 'platform_admin'
  ) or exists (
    select 1 from platform_admins
    where user_id = auth.uid()
  );
$$;
