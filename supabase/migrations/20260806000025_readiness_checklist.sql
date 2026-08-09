-- Lifecycle & Compliance Expansion, Gate 1.5: "Readiness checklist +
-- deterministic scoring + gated override" (flag PERMITFIELD_FF_READINESS).
-- Additive only against every prior migration: no existing column, row, or
-- enum value is renamed, retyped, or removed.
--
-- Architecture citation: PHASE_0_FINDINGS.md SS O (the Gate 1.5 pre-branch
-- addendum, agreed with the user before this branch existed):
--   O.1 -- `source_requirement` ships as a nullable free-text column now,
--         no FK. It will be constrained to `permit_requirements(id)` once
--         Gate 1.6 creates that table -- see the column comment below.
--   O.2 -- `transition_permit_status()` (20260806000022) is modified in
--         this migration to add a new precondition -- Check 5 -- on the
--         `internal_review -> ready_to_submit` edge specifically: every
--         required checklist item must be complete, or a readiness
--         override must already be recorded on the application. This is a
--         real modification to already-shipped Gate 1.3 code, done with the
--         user's explicit go-ahead (not a silent reach-back). The function
--         is reproduced in full below via CREATE OR REPLACE, same pattern
--         every other RPC edit in this repo uses (there is no ALTER
--         FUNCTION ... ADD CHECK equivalent in plpgsql).
--   O.3 -- entitlement keys use this repo's established dot-namespaced
--         convention (`readiness.checker`, `readiness.override`), not the
--         master prompt's literal spelling (`readiness_checker`,
--         `readiness_override`) -- see lib/entitlements/index.ts.
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently decided):
--   - No role restriction on marking a checklist item complete/rejected.
--     The master prompt's SS3.7 only specifies a role gate for the
--     OVERRIDE ("requires permit_manager or above"); ordinary checklist
--     completion has no stated role restriction, so this migration treats
--     it the same as permit_status_tier()'s 'org' tier ("the org's own
--     work ... self-attestation is correct here",
--     20260806000022 L51-54): any org member may create/update/read a
--     checklist item, is_org_member()-gated RLS, no SECURITY DEFINER RPC
--     wrapper. This deliberately differs from application_documents' own
--     review columns (status/reviewed_by/reviewed_at/rejection_reason,
--     20260806000024), which shipped with NO update policy at all pending a
--     follow-up RPC (Gate 1.4.1) -- that deferral was possible because nothing
--     else in Gate 1.4 depended on those columns being writable. Here, Check
--     5 below is a real, in-scope, working gate on `ready_to_submit`
--     (PHASE_0_FINDINGS.md SS O.2), so the checklist must actually be
--     completable within this same gate or Check 5 would permanently block
--     every application except via override. Flagged here per rule 8 as a
--     judgment call, not a spec citation, same discipline Gate 1.3 used for
--     its three correction/resubmission state names.
--   - No role restriction narrower than "is_org_member" distinguishes who
--     may set `reviewed_by`/`reviewed_at` on a checklist item from who may
--     merely mark it complete -- same reasoning as above. A future gate can
--     tighten this exactly the way Gate 1.4.1 is expected to tighten
--     application_documents' review columns.
--   - No entitlement check appears anywhere in this file. `can()`/`limit()`
--     (lib/entitlements/index.ts) are pure TypeScript with zero DB access
--     and no notion of the current request -- they are evaluated by a
--     Route Handler/Server Action before it calls into a SECURITY DEFINER
--     RPC, the same "declared now, enforced later at the call site" pattern
--     every flag in lib/flags.ts already follows. `readiness.checker`/
--     `readiness.override` are added to that module in this same gate (per
--     O.3) so the future call site has them ready; override_readiness_check()
--     below still enforces its ROLE gate at the DB layer (the one thing a
--     RPC actually can enforce), independent of and prior to whatever
--     entitlement check a future route adds in front of it.
--   - `title`/`description` are not in SS3.7's explicit field list (that
--     list is metadata: required/optional, responsible party, due date,
--     completion status, reviewer, review timestamp, rejection reason,
--     related document, source requirement, last verified date) -- SS3.7
--     itself says "per the brief" for the base fields, and "the brief" is
--     not a file present in this repo. A checklist item with no name is not
--     useful, so `title` (not null) is added as the obvious minimum
--     identity field, same judgment-call flag as above.

-- 'complete' (not 'approved') to match SS3.7's literal wording
-- ("completion status"); shape otherwise mirrors document_review_status
-- (20260806000024) exactly: pending -> complete | rejected.
create type readiness_item_status as enum ('pending', 'complete', 'rejected');

create table readiness_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  title text not null,
  description text,
  -- required/optional (SS3.7). Defaults to true: an org creating a
  -- checklist item is presumed to be tracking something that blocks
  -- submission unless they say otherwise, same "safer default" reasoning
  -- lib/flags.ts's header comment uses for flags-off-by-default.
  is_required boolean not null default true,
  responsible_party text,
  due_date date,
  status readiness_item_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  -- Plain (non-composite) FK -- application_documents has no org_id column
  -- of its own to pair into a composite FK, same reasoning
  -- permit_applications.decision_document_id documented (20260806000022
  -- L141-147).
  related_document_id uuid references application_documents(id) on delete set null,
  -- Nullable; will be constrained to permit_requirements(id) in Gate 1.6
  -- (PHASE_0_FINDINGS.md SS O.1). Same "the migration cites its own future
  -- constraint" discipline permit_status's evidence columns and Gate 1.4's
  -- review columns both followed.
  source_requirement text,
  last_verified_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade
);

alter table readiness_checklist_items
  add constraint readiness_checklist_items_reviewed_pair
    check ((reviewed_by is null) = (reviewed_at is null)),
  add constraint readiness_checklist_items_rejection_reason_requires_rejected
    check (rejection_reason is null or status = 'rejected');

create index readiness_checklist_items_org_id_idx on readiness_checklist_items (org_id);
create index readiness_checklist_items_application_id_idx on readiness_checklist_items (org_id, application_id);
create index readiness_checklist_items_related_document_id_idx on readiness_checklist_items (related_document_id);

alter table readiness_checklist_items enable row level security;

create policy readiness_checklist_items_select on readiness_checklist_items
  for select to authenticated
  using (is_org_member(org_id));

create policy readiness_checklist_items_insert on readiness_checklist_items
  for insert to authenticated
  with check (is_org_member(org_id));

create policy readiness_checklist_items_update on readiness_checklist_items
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

-- Delete restricted to is_org_owner, same asymmetry as permit_applications
-- itself (20260806000006 L71-73) -- ordinary org members can create/edit
-- checklist items, but removing one outright (as opposed to marking it
-- rejected/not-required) is an owner-level action. This is also the exact
-- "checklist item deleted" bypass path the master prompt's own QA checklist
-- names (SS12 #8: "Override abuse ... include indirect paths -- direct
-- status write, checklist item deleted, requirement marked optional,
-- requirement archived") -- restricting delete to org owners does not
-- close that path by itself (an org_owner can still delete a blocking
-- item), but it does remove it from every non-owner role, same boundary
-- permit_applications_delete already draws.
create policy readiness_checklist_items_delete on readiness_checklist_items
  for delete to authenticated
  using (is_org_owner(org_id));

grant select, insert, update, delete on readiness_checklist_items to authenticated;

-- No `updated_at`-maintaining trigger -- matches every existing table in
-- this schema (grep-confirmed zero BEFORE UPDATE triggers exist anywhere in
-- supabase/migrations/ for this purpose, per 20260806000019's own comment).
-- `updated_at` is set explicitly by the calling Server Action once one
-- exists, same convention as the rest of the codebase.

-- Deterministic readiness score, computed on demand from checklist rows
-- only -- no cache column, no denormalized number that can drift (SS3.7:
-- "If it can be computed, compute it"). Runs as the CALLER's own privileges
-- (no SECURITY DEFINER) so it is naturally org-scoped by
-- readiness_checklist_items' own SELECT RLS policy -- a caller who cannot
-- read an application's checklist rows gets zero rows back here too, not a
-- privilege-escalated peek. required_total = 0 is treated as 100 (vacuously
-- ready -- an application with no required items has nothing left to
-- complete); this edge case is not spec-mandated, flagged here as a
-- judgment call.
create or replace function compute_readiness_score(p_application_id uuid)
returns numeric
language sql
stable
as $$
  select case
    when count(*) filter (where is_required) = 0 then 100
    else round(
      100.0 * count(*) filter (where is_required and status = 'complete')
      / count(*) filter (where is_required),
      2
    )
  end
  from readiness_checklist_items
  where application_id = p_application_id;
$$;

grant execute on function compute_readiness_score(uuid) to authenticated, service_role;

-- Boolean form used by transition_permit_status()'s Check 5 below --
-- separate from compute_readiness_score() so the hot-path gate does not
-- need to parse a numeric percentage back into a boolean, and so a future
-- caller that only needs "is it ready" does not pay for the score
-- computation. Same "any required item incomplete" definition as the score
-- function's denominator.
create or replace function readiness_checklist_complete(p_application_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from readiness_checklist_items
    where application_id = p_application_id
      and is_required
      and status <> 'complete'
  );
$$;

grant execute on function readiness_checklist_complete(uuid) to authenticated, service_role;

-- Readiness override state lives directly on permit_applications (SS3.7:
-- "is surfaced permanently on the application record") rather than a
-- separate table -- there is exactly one live override per application at
-- a time (the most recent one), and "permanent" here means it is never
-- cleared once set, not that a history of overrides needs to be queried
-- independently of audit_logs (which already records every override event,
-- see override_readiness_check() below).
--
-- Column-level write protection comes for free: 20260806000022 (Gate 1.3)
-- already revoked table-level UPDATE on permit_applications from
-- `authenticated` and re-granted it back on exactly one column (`status`).
-- These three new columns are therefore NOT updatable directly by
-- `authenticated` from the moment they're created -- no additional
-- revoke/grant statement is needed in this migration, since there is no
-- pre-existing broader grant left for a column-level restriction to fail to
-- override (same "closes the gap by construction" reasoning as that
-- migration's own tail comment, 20260806000022 L552-562).
-- override_readiness_check() below is SECURITY DEFINER, so it is
-- unaffected either way.
alter table permit_applications
  add column readiness_override_at timestamptz,
  add column readiness_override_by uuid references auth.users(id),
  add column readiness_override_reason text;

alter table permit_applications
  add constraint permit_applications_readiness_override_triplet
    check (
      (readiness_override_at is null) = (readiness_override_by is null)
      and (readiness_override_at is null) = (readiness_override_reason is null)
    );

-- Sanctioned write path for a readiness override (SS3.7). SECURITY
-- DEFINER, same shape as transition_permit_status()/
-- replace_application_document(): explicit org-membership + role checks as
-- the function's own first statements, since SECURITY DEFINER bypasses
-- permit_applications' RLS entirely.
--
-- Role gate: reuses permit_status_tier()'s 'submission' tier role list
-- verbatim (owner, org_owner, platform_admin, permit_manager) -- SS3.7 says
-- "requires permit_manager or above", and that is the exact role list
-- 20260806000022 already established as "permit_manager or above" for the
-- submission tier. Not read from permit_status_tier() itself (that function
-- takes a permit_status_enum, not a bare role check) -- the literal list is
-- inlined here, same as transition_permit_status() inlines its own tier
-- role lists rather than deriving them.
--
-- Minimum reason length: 20 characters. Not spec-mandated (SS3.7 only says
-- "min length enforced") -- this migration's judgment call, chosen to rule
-- out placeholder text ("ok", "approved", "n/a") while remaining reachable
-- in one short sentence. Flagged here per rule 8 as a judgment call, not a
-- spec citation, same discipline as Gate 1.3's correction-state names.
--
-- Writes audit_logs directly (INSERT, not lib/audit/log.ts's writeAuditLog
-- -- this function is SQL, not TypeScript) with action = 'readiness_override'
-- (audit_logs.action is a free text column, no enum, no migration needed --
-- PHASE_0_FINDINGS.md SS O's "not blocked" preview). Runs as this
-- function's owner (SECURITY DEFINER), so it does not need and is not
-- granted any table-level INSERT privilege on audit_logs -- same "writes as
-- the function owner" shape as seed_permit_status_history() writing to
-- application_status_history (20260806000022 L357-368).
create or replace function override_readiness_check(
  p_application_id uuid,
  p_reason text
)
returns permit_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications;
  v_role org_role;
begin
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'permit_application % not found', p_application_id;
  end if;

  if not is_org_member(v_app.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();

  if v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not override the readiness checklist (requires permit_manager or above)', v_role
      using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 20 then
    raise exception 'invalid_reason: readiness override reason must be at least 20 characters'
      using errcode = '22023';
  end if;

  update permit_applications
  set readiness_override_at = now(),
      readiness_override_by = auth.uid(),
      readiness_override_reason = btrim(p_reason)
  where id = p_application_id
  returning * into v_app;

  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  values (
    v_app.org_id,
    auth.uid(),
    v_role,
    'readiness_override',
    'permit_application',
    v_app.id,
    jsonb_build_object('reason', v_app.readiness_override_reason)
  );

  return v_app;
end;
$$;

revoke all on function override_readiness_check(uuid, text) from public;
grant execute on function override_readiness_check(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- transition_permit_status(): reproduced in full via CREATE OR REPLACE to
-- add Check 5 (PHASE_0_FINDINGS.md SS O.2). Every other line in this
-- function is byte-for-byte identical to 20260806000022's definition --
-- only the new Check 5 block (inserted after the existing cross-machine
-- gate, before the write) and this header comment are new. plpgsql has no
-- ALTER FUNCTION ... ADD CHECK equivalent, so a full CREATE OR REPLACE is
-- the only way to extend an existing function's body; this is the same
-- mechanism every prior RPC edit in this repo has used.
-- ---------------------------------------------------------------------------
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

  -- Idempotency reservation -- see 20260806000022's header comment.
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

  if v_tier = 'submission' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not move an application into submission-tier status % (requires permit_manager or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if v_tier = 'jurisdiction_outcome' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager', 'permit_coordinator') then
    raise exception 'insufficient_privilege: role % may not record jurisdiction-outcome status % (requires permit_coordinator or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  -- Cross-machine gate: see 20260806000022's header comment (SS L.3(b)).
  if p_to_status = 'submitted' and v_app.status <> 'submitted' then
    raise exception 'pipeline_not_submitted: cannot advance permit_status to submitted until the document pipeline status is submitted (currently %)', v_app.status;
  end if;

  -- Check 5 (Gate 1.5, PHASE_0_FINDINGS.md SS O.2): the
  -- internal_review -> ready_to_submit edge additionally requires every
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
