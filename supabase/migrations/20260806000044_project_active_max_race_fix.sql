-- Health-check audit round 3 finding: createProjectAction
-- (app/(app)/projects/new/actions.ts) enforces `projects.active_max`
-- (lib/entitlements) via a check-then-act pattern -- a live `SELECT count(*)`
-- against `projects` followed, several statements later, by a call to
-- create_project_with_intake() to actually insert the row. Each of those is
-- its own PostgREST round trip/statement; nothing in between holds a lock,
-- so two concurrent createProjectAction calls for the same org can each read
-- a count that's still under the limit and both proceed, jointly exceeding
-- `projects.active_max` -- the same race class as 20260806000043's
-- application_documents total-bytes fix and, before that,
-- 20260806000020's own atomicity fix for this exact function (client/
-- property/project all in one transaction, but that transaction never
-- guarded against a *second, concurrent* transaction doing the same
-- check-then-insert).
--
-- Fix: move the authoritative limit check inside create_project_with_intake
-- itself, serialized with the same pg_advisory_xact_lock(hashtextextended(...))
-- pattern 20260806000043 established -- the lock is scoped to this org_id, held
-- only for the duration of this transaction, and released automatically at
-- transaction end (commit or rollback), so a concurrent call for a
-- *different* org is never blocked. p_max_active_projects is passed in by
-- the caller (createProjectAction still calls lib/entitlements's limit(),
-- since entitlements config is TypeScript-side, not something this SQL
-- function can look up) and defaults to null, meaning "no limit configured
-- for this org" -- matches lib/entitlements's own "absence of a configured
-- limit means unlimited" semantics, so existing/other callers of this
-- function that don't pass the new parameter are unaffected.
--
-- The application-layer precheck in createProjectAction is left in place
-- (not removed) for the same reason 20260806000043's header comment gives
-- for application_documents: it's still a valid fast, pre-RPC rejection for
-- the common (non-racing) case, avoiding a wasted round trip; this
-- advisory-lock-guarded recheck inside the function is the actual source of
-- truth.
--
-- DROP first, not just CREATE OR REPLACE: Postgres function identity
-- includes the parameter list, so adding a new (even defaulted) trailing
-- parameter via CREATE OR REPLACE does not replace the original 15-argument
-- function -- it creates a second, overloaded one. Since the new parameter
-- has a default, a call using only the original 15 named arguments would
-- then match both overloads and fail with an "ambiguous function call"
-- error. Dropping the old signature explicitly first avoids ever having two
-- overloads live at once.
drop function if exists create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text);

create function create_project_with_intake(
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
  p_postal_code text default null,
  p_max_active_projects integer default null
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
  v_active_count integer;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Serialize concurrent create_project_with_intake calls for the same org
  -- so the active-project count check below can't race with another
  -- in-flight call for that same org -- see this migration's header
  -- comment. hashtextextended(..., 0) folds the uuid down to a bigint lock
  -- key, same as 20260806000043's identical use of this pattern.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  if p_max_active_projects is not null then
    select count(*) into v_active_count
    from projects
    where org_id = p_org_id and archived_at is null;

    if v_active_count >= p_max_active_projects then
      raise exception 'active_project_limit_reached: organization % has reached its limit of % active projects', p_org_id, p_max_active_projects
        using errcode = 'check_violation';
    end if;
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

-- Same grant shape as the original 20260806000020 migration -- the function
-- signature changed (new trailing p_max_active_projects parameter), so this
-- revoke/grant pair must be re-run against the new signature; the old
-- 15-argument overload no longer exists after CREATE OR REPLACE above (a
-- REPLACE with a different argument list does not leave the old signature
-- behind -- there is only ever one create_project_with_intake).
revoke all on function create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text, integer) from public;
grant execute on function create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text, integer) to authenticated;
