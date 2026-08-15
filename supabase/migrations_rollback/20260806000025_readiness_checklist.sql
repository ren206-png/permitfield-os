-- Rollback for 20260806000025_readiness_checklist.sql
-- transition_permit_status() is restored to its pre-this-migration
-- (20260806000022) body via CREATE OR REPLACE -- this migration modified it
-- in place to add Check 5 (the readiness-complete-or-overridden gate on the
-- internal_review -> ready_to_submit edge); every other line is byte-for-byte
-- identical to 20260806000022's original definition, so removing exactly the
-- Check 5 block restores it. The function is not dropped, since it originates
-- in 20260806000022, not here.
-- Everything else this migration created is then undone in reverse creation
-- order: override_readiness_check() -> the three readiness_override_* columns
-- on permit_applications -> readiness_checklist_complete() ->
-- compute_readiness_score() -> readiness_checklist_items (policies, grant,
-- table) -> the readiness_item_status type.

create or replace function transition_permit_status(
  p_application_id uuid,
  p_to_status permit_status_enum,
  p_reason text default null,
  p_request_key uuid default null
)
returns permit_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications;
  v_from_status permit_status_enum;
  v_role org_role;
  v_tier text;
  v_row_count int;
begin
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'permit_application % not found', p_application_id;
  end if;

  if not is_org_member(v_app.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  v_from_status := v_app.permit_status;

  insert into application_status_history (org_id, application_id, from_status, to_status, changed_by, reason, request_key)
  values (v_app.org_id, v_app.id, v_from_status, p_to_status, auth.uid(), p_reason, p_request_key)
  on conflict (org_id, application_id, request_key) where request_key is not null do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    return v_app;
  end if;

  if not exists (
    select 1 from permit_status_transitions
    where from_status is not distinct from v_from_status
      and to_status = p_to_status
  ) then
    raise exception 'invalid_transition: % -> % is not a legal permit_status transition', v_from_status, p_to_status
      using errcode = '22023';
  end if;

  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();
  v_tier := permit_status_tier(p_to_status);

  if v_tier = 'submission' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not move an application into submission-tier status % (requires permit_manager or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if v_tier = 'jurisdiction_outcome' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager', 'permit_coordinator') then
    raise exception 'insufficient_privilege: role % may not record jurisdiction-outcome status % (requires permit_coordinator or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if p_to_status = 'submitted' and v_app.status <> 'submitted' then
    raise exception 'pipeline_not_submitted: cannot advance permit_status to submitted until the document pipeline status is submitted (currently %)', v_app.status;
  end if;

  update permit_applications
  set permit_status = p_to_status, updated_at = now()
  where id = p_application_id
    and permit_status = v_from_status
  returning * into v_app;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'concurrent_transition: permit_status for application % changed since this transition was validated (expected %); retry the request', p_application_id, v_from_status
      using errcode = '40001';
  end if;

  return v_app;
end;
$$;

revoke all on function transition_permit_status(uuid, permit_status_enum, text, uuid) from public;
grant execute on function transition_permit_status(uuid, permit_status_enum, text, uuid) to authenticated;

revoke all on function override_readiness_check(uuid, text) from authenticated;
drop function if exists override_readiness_check(uuid, text);

alter table permit_applications drop constraint if exists permit_applications_readiness_override_triplet;

alter table permit_applications drop column if exists readiness_override_reason;
alter table permit_applications drop column if exists readiness_override_by;
alter table permit_applications drop column if exists readiness_override_at;

revoke execute on function readiness_checklist_complete(uuid) from authenticated, service_role;
drop function if exists readiness_checklist_complete(uuid);

revoke execute on function compute_readiness_score(uuid) from authenticated, service_role;
drop function if exists compute_readiness_score(uuid);

revoke select, insert, update, delete on readiness_checklist_items from authenticated;

drop policy if exists readiness_checklist_items_delete on readiness_checklist_items;
drop policy if exists readiness_checklist_items_update on readiness_checklist_items;
drop policy if exists readiness_checklist_items_insert on readiness_checklist_items;
drop policy if exists readiness_checklist_items_select on readiness_checklist_items;

drop table if exists readiness_checklist_items;

drop type if exists readiness_item_status;
