-- Health-check audit round 3 finding: transition_permit_status()'s Check 2
-- (20260806000022) role-gates the 'submission' tier (permit_manager or
-- above) and the 'jurisdiction_outcome' tier (permit_coordinator or above),
-- but has NO role check at all for the 'org' tier -- any is_org_member
-- caller, regardless of role, can move an application into any org-tier
-- status (intake, requirements_review, collecting_documents,
-- internal_review, ready_to_submit, withdrawn), including document_reviewer
-- and auditor_readonly, roles whose entire design (see lib/authz/index.ts's
-- own per-role reasoning comments) is explicitly narrower than that.
--
-- This contradicts two things that both already claim the org tier IS
-- role-gated:
--   1. This migration's own header comment (20260806000022 L51-54): "org
--      (6): ... the org's own work, full existing permit_applications-write
--      role set" -- naming a specific, narrower role set, not "any member".
--   2. docs/STATUS_TRANSITIONS.md's tier table, which spells out that same
--      role set by name: owner, org_owner, platform_admin, member,
--      permit_manager, permit_coordinator, applicant_contractor.
--   3. lib/permit-status/transitions.ts's ORG_TIER_ROLES constant, which
--      already encodes exactly that same 7-role list and documents itself
--      as "mirrors transition_permit_status()'s Check 2 exactly" -- a claim
--      that was actually false before this fix, since Check 2 had no org-
--      tier branch to mirror at all.
--
-- Fix: add the missing org-tier branch to Check 2, using the exact same
-- 7-role list ORG_TIER_ROLES/docs/STATUS_TRANSITIONS.md already document,
-- restoring the SQL function to what its own comments and the TypeScript
-- mirror always claimed it did. This is a real privilege-escalation-shaped
-- gap being closed, not a new restriction being invented: document_reviewer,
-- client_user, and auditor_readonly could previously call this RPC directly
-- (bypassing any UI that might otherwise gate the same action) to drive an
-- application through the org-tier lifecycle, including to the terminal
-- 'withdrawn' status.
--
-- Base version correction: this migration was originally authored by
-- reproducing 20260806000022's ORIGINAL function body and inserting the new
-- org-tier branch into it. That was wrong -- 20260806000025 had already
-- re-issued this same function via its own CREATE OR REPLACE to add Check 5
-- (the internal_review -> ready_to_submit readiness-checklist gate), and
-- starting from the stale 000022 body would have silently reverted Check 5,
-- re-opening a hole this repo's own supabase/tests/readiness_checklist.test.sql
-- caught immediately (a required-item-pending application could reach
-- ready_to_submit again). This version instead starts from 20260806000025's
-- body verbatim and layers only the new org-tier branch on top, same as
-- every other line here already being byte-for-byte identical to that prior
-- migration's definition.
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

  -- Idempotency reservation -- see the comment above this function.
  insert into application_status_history (org_id, application_id, from_status, to_status, changed_by, reason, request_key)
  values (v_app.org_id, v_app.id, v_from_status, p_to_status, auth.uid(), p_reason, p_request_key)
  on conflict (org_id, application_id, request_key) where request_key is not null do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    return v_app; -- idempotent no-op: this exact request_key was already recorded.
  end if;

  -- Check 1: transition legality, independent of who is asking.
  if not exists (
    select 1 from permit_status_transitions
    where from_status is not distinct from v_from_status
      and to_status = p_to_status
  ) then
    raise exception 'invalid_transition: % -> % is not a legal permit_status transition', v_from_status, p_to_status
      using errcode = '22023';
  end if;

  -- Check 2: role authorization for the tier being entered, independent of
  -- whether the move itself is legal.
  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();
  v_tier := permit_status_tier(p_to_status);

  -- Health-check audit round 3 fix: the org tier previously had no role
  -- branch at all (see this migration's header comment) -- restored to the
  -- exact 7-role set docs/STATUS_TRANSITIONS.md and
  -- lib/permit-status/transitions.ts's ORG_TIER_ROLES already document as
  -- this tier's real boundary: the org's own day-to-day permitting-workflow
  -- roles, not document_reviewer/client_user/auditor_readonly.
  if v_tier = 'org' and v_role not in ('owner', 'org_owner', 'platform_admin', 'member', 'permit_manager', 'permit_coordinator', 'applicant_contractor') then
    raise exception 'insufficient_privilege: role % may not move an application into org-tier status % (requires the org''s permitting-workflow role set)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if v_tier = 'submission' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not move an application into submission-tier status % (requires permit_manager or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if v_tier = 'jurisdiction_outcome' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager', 'permit_coordinator') then
    raise exception 'insufficient_privilege: role % may not record jurisdiction-outcome status % (requires permit_coordinator or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  -- Cross-machine gate: see this migration's header comment (SS L.3(b)).
  if p_to_status = 'submitted' and v_app.status <> 'submitted' then
    raise exception 'pipeline_not_submitted: cannot advance permit_status to submitted until the document pipeline status is submitted (currently %)', v_app.status;
  end if;

  -- Check 5 (Gate 1.5, PHASE_0_FINDINGS.md SS O.2, added by 20260806000025):
  -- the internal_review -> ready_to_submit edge additionally requires every
  -- REQUIRED readiness checklist item to be complete, unless a readiness
  -- override has already been recorded on this application (see
  -- override_readiness_check() and readiness_checklist_complete(),
  -- 20260806000025). Checked after legality/role/cross-machine (a request
  -- that's illegal, unauthorized, or pipeline-blocked fails for that reason
  -- first) and before the write. Scoped to exactly this one edge -- no
  -- other transition in this machine reads readiness_checklist_items or
  -- permit_applications.readiness_override_at at all.
  if p_to_status = 'ready_to_submit'
     and v_app.readiness_override_at is null
     and not readiness_checklist_complete(p_application_id) then
    raise exception 'readiness_incomplete: application % has incomplete required readiness checklist items; complete them or record a readiness override', p_application_id
      using errcode = '22023';
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
