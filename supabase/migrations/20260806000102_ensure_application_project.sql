-- Project facts and requirement checks are kept per project
-- (project_facts, project_requirement_snapshots, 092), but applications
-- created in the app have no project: on 2026-10-30 production had 6
-- applications and 0 projects, so the requirements check panel (#101) could
-- not appear anywhere. ensure_application_project() gives an application
-- its project the first time someone uses the panel: it creates a minimal
-- project named after the application (source = 'application', like 023's
-- 'backfill' placeholders) and links it, or returns the existing one.
--
-- SECURITY DEFINER because authenticated may UPDATE only
-- permit_applications.status (022 revokes the rest), so it checks what RLS
-- would: the caller must be signed in and a member of the application's
-- org (is_org_member), otherwise the application is "not found" -- same
-- answer as for one that doesn't exist, so nothing leaks. It touches only
-- project_id, and only when it is null. The row lock makes concurrent
-- first uses safe: the second caller waits, then sees the project the
-- first one linked.
--
-- Rollback (valid while nothing calls it):
--   drop function if exists ensure_application_project(uuid);

create function ensure_application_project(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
  v_project_id uuid;
begin
  -- Membership first, so a non-member can't even hold the row lock.
  if auth.uid() is null or not exists (
    select 1 from permit_applications where id = p_application_id and is_org_member(org_id)
  ) then
    raise exception 'application % not found', p_application_id using errcode = 'no_data_found';
  end if;
  select id, org_id, project_id, project_title into v_app
  from permit_applications where id = p_application_id
  for update;
  if v_app.project_id is not null then
    return v_app.project_id;
  end if;

  insert into projects (org_id, title, status, source)
  values (v_app.org_id, coalesce(nullif(btrim(v_app.project_title), ''), 'Permit application'), 'draft', 'application')
  returning id into v_project_id;

  update permit_applications set project_id = v_project_id where id = v_app.id;
  return v_project_id;
end;
$$;

revoke execute on function ensure_application_project(uuid) from public, anon;
grant execute on function ensure_application_project(uuid) to authenticated;
