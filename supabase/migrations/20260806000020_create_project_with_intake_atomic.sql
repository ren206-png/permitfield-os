-- Lifecycle & Compliance Expansion, Phase 1.1 follow-up: fixes a gap the
-- Phase 1.1 report's own adversarial self-check (question 6) flagged and
-- explicitly left unfixed at the time -- createProjectAction
-- (app/(app)/projects/new/actions.ts) was doing three *sequential*,
-- independent `.insert()` calls (clients, then properties, then projects)
-- over PostgREST. Each call is its own transaction; if the client insert
-- succeeded but the property or project insert then failed (e.g. a bad
-- FK, an entitlement race, a network blip), the client row was left behind
-- with nothing referencing it -- a silent orphan, not caught by any
-- existing test.
--
-- Fix: wrap all three inserts in one `security definer` function, the same
-- pattern `create_organization_with_owner` (20260806000002, extended
-- 20260806000019) already established in this codebase for atomic
-- multi-table writes. A single RPC call is a single statement from
-- PostgREST's perspective, hence one transaction -- if the project insert
-- fails after the function's own client/property inserts already ran
-- in-transaction, the whole call rolls back, including those inserts. No
-- new locking or explicit `begin`/`commit` is needed: this is ordinary
-- Postgres function-body atomicity, not a new mechanism.
--
-- `security definer` bypasses RLS, so this function does its own
-- `is_org_member(p_org_id)` check up front -- same discipline
-- `create_organization_with_owner` uses for `auth.uid()` -- rather than
-- relying on the `clients_insert`/`properties_insert`/`projects_insert`
-- policies, which do not run for a security-definer function's own writes.
-- This is a second, DB-level enforcement of the same org-membership
-- boundary createProjectAction's own `can(role, 'create', 'projects')`
-- check already enforces at the application layer -- defense in depth, not
-- a replacement for it. The composite FKs from 20260806000019 (client_id/
-- property_id/taxonomy_id all `(org_id, x_id) references x (org_id, id)`)
-- still apply unchanged inside this function -- constraints are not RLS and
-- are never bypassed by `security definer`.
create or replace function create_project_with_intake(
  p_org_id uuid,
  p_title text,
  p_description text,
  p_taxonomy_id uuid,
  p_property_owner_name text,
  p_applicant_name text,
  p_status project_status default 'draft',
  p_client_name text default null,
  p_client_email text default null,
  p_client_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_province_code text default null,
  p_postal_code text default null
)
returns table (project_id uuid, client_id uuid, property_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_property_id uuid;
  v_project_id uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Same optionality as createProjectAction's own logic (now moved here
  -- verbatim, not duplicated): a client is only created if a name was
  -- given, a property only if the caller supplied one (the caller --
  -- lib/intake/schemas.ts's CreateProjectFormSchema -- already guarantees
  -- the four address fields are all-or-nothing before this function is
  -- ever called, so checking address_line1 alone here is sufficient, not a
  -- weaker re-validation of that rule).
  if p_client_name is not null then
    insert into clients (org_id, name, email, phone)
    values (p_org_id, p_client_name, p_client_email, p_client_phone)
    returning id into v_client_id;
  end if;

  if p_address_line1 is not null then
    insert into properties (org_id, client_id, address_line1, address_line2, city, province_code, postal_code)
    values (p_org_id, v_client_id, p_address_line1, p_address_line2, p_city, p_province_code, p_postal_code)
    returning id into v_property_id;
  end if;

  insert into projects (org_id, client_id, property_id, taxonomy_id, title, description, property_owner_name, applicant_name, status)
  values (p_org_id, v_client_id, v_property_id, p_taxonomy_id, p_title, p_description, p_property_owner_name, p_applicant_name, p_status)
  returning id into v_project_id;

  return query select v_project_id, v_client_id, v_property_id;
end;
$$;

-- Same grant shape as create_organization_with_owner (20260806000002):
-- explicit revoke from public first, since security-definer functions run
-- with the definer's (superuser/postgres) privileges and would otherwise be
-- callable by anyone who can reach the database.
revoke all on function create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text) from public;
grant execute on function create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text) to authenticated;
