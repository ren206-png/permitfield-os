-- Lifecycle & Compliance Expansion, Gate 1.7: "Dashboard query layer"
-- (flag PERMITFIELD_FF_DASHBOARD). Additive only against every prior
-- migration: no existing column, row, or enum value is renamed, retyped,
-- or removed.
--
-- Architecture citation: PHASE_0_FINDINGS.md SS S (the Gate 1.7 pre-branch
-- addendum, agreed with the user before this branch existed):
--   S.1 -- the master prompt's SS3.8 says "Panels per the brief" and
--         supplies no panel list, and no such brief exists anywhere in this
--         repo. The five panels below are the user-approved replacement
--         content, each grounded in a table that already exists and is
--         already RLS-scoped: project status distribution, permit pipeline
--         (permit_status_enum), readiness score buckets (reusing
--         compute_readiness_score(), 20260806000025, per SS3.7's own "no
--         cached denormalized number" rule), requirements-engine outcomes
--         (project_permit_requirements, 20260806000026/27), and document
--         review status (application_documents, 20260806000024).
--   S.2 -- uniform visibility, approved: every org member (any of the 8
--         org_role values, or legacy owner/member) sees every panel, gated
--         only by is_org_member(org_id) -- no per-role filtering in this
--         gate. No new RLS policy is needed anywhere in this migration as a
--         result: every function below is a plain (non-SECURITY DEFINER)
--         `language sql stable` function, so it runs as the CALLER's own
--         privileges and is naturally org-scoped by each underlying table's
--         existing SELECT RLS policy -- exactly compute_readiness_score()'s
--         own precedent (20260806000025 L157-166: "Runs as the CALLER's own
--         privileges ... a caller who cannot read ... gets zero rows back
--         here too, not a privilege-escalated peek"). A caller who passes an
--         org_id they are not a member of gets zero rows, not an error --
--         same behavior as querying the underlying table directly.
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently decided):
--   - No UI, route, or Server Action. The user explicitly scoped this gate
--     to "the dashboard query layer" -- five SQL functions plus the
--     `analytics` entitlement key and PERMITFIELD_FF_DASHBOARD flag, all
--     with zero call site, same "schema/RPC now, UI later" pattern every
--     flag in lib/flags.ts already follows (isJurisdictionsEnabled,
--     isApplicationsEnabled, isReadinessEnabled, isRequirementsEnabled all
--     shipped their migration with no UI in the same gate). SS3.8's "every
--     panel implements four states: loading, empty, error, permission-denied"
--     is a UI-layer requirement that the future dashboard route/Server
--     Component satisfies by (a) checking is_org_member + can(orgId,
--     'analytics') before ever calling these functions (permission-denied,
--     no query issued) and (b) treating a 0-row result as the empty state
--     (a real, valid "nothing here yet" answer, not a permission failure) --
--     documented here as the intended contract for that future call site,
--     not implemented in this gate.
--   - Query count per dashboard load: 5 -- one function call per panel, each
--     a single round trip. None of the five loop per-row from the
--     application; the readiness panel in particular reuses
--     compute_readiness_score() via a scalar subquery inside ONE aggregate
--     query (S.1 above) rather than calling it once per application from
--     application code, which is the N+1 shape SS3.8 explicitly forbids.
--   - No entitlement check appears anywhere in this file, same "declared
--     now, enforced later at the call site" pattern SS O.3 established for
--     readiness.checker/readiness.override and SS Q.6 for
--     jurisdiction.requirements -- can()/limit() are pure TypeScript with no
--     DB access, evaluated by a future Route Handler/Server Action before it
--     calls any function below.

-- Panel 1: project status distribution (projects.status, project_status
-- enum: draft/active/on_hold/completed/archived). Single-table group-by,
-- RLS-scoped via projects_select's existing is_org_member(org_id) policy
-- (20260806000019).
create or replace function dashboard_project_status_counts(p_org_id uuid)
returns table (status project_status, count bigint)
language sql
stable
as $$
  select status, count(*)
  from projects
  where org_id = p_org_id
  group by status;
$$;

grant execute on function dashboard_project_status_counts(uuid) to authenticated, service_role;

-- Panel 2: permit pipeline (permit_applications.permit_status,
-- permit_status_enum, 16 values, 20260806000022). Single-table group-by,
-- RLS-scoped via permit_applications_select's existing
-- is_org_member(org_id) policy (20260806000006).
create or replace function dashboard_permit_status_counts(p_org_id uuid)
returns table (permit_status permit_status_enum, count bigint)
language sql
stable
as $$
  select permit_status, count(*)
  from permit_applications
  where org_id = p_org_id
  group by permit_status;
$$;

grant execute on function dashboard_permit_status_counts(uuid) to authenticated, service_role;

-- Panel 3: readiness score buckets. Reuses compute_readiness_score()
-- (20260806000025) per-application via a scalar subquery inside one
-- aggregate query -- ONE round trip from the caller, not one
-- compute_readiness_score() call per application from application code
-- (that would be the exact N+1 shape SS3.8 forbids). Bucket boundaries
-- (ready = 100, in_progress = [50, 100), at_risk = [0, 50)) are not
-- spec-mandated -- a judgment call, same "flagged, not spec-derived"
-- treatment compute_readiness_score()'s own 0-required-items-is-100 edge
-- case got. RLS-scoped via permit_applications_select
-- (is_org_member(org_id)); compute_readiness_score() is itself RLS-scoped
-- via readiness_checklist_items_select (same is_org_member(org_id) check),
-- so a caller who cannot read an application's checklist rows gets 0 for
-- that application's score inputs, not a privilege-escalated peek -- same
-- guarantee compute_readiness_score()'s own header comment states.
create or replace function dashboard_readiness_score_buckets(p_org_id uuid)
returns table (bucket text, count bigint)
language sql
stable
as $$
  with scores as (
    select id as application_id, compute_readiness_score(id) as score
    from permit_applications
    where org_id = p_org_id
  )
  select
    case
      when score = 100 then 'ready'
      when score >= 50 then 'in_progress'
      else 'at_risk'
    end as bucket,
    count(*)
  from scores
  group by 1;
$$;

grant execute on function dashboard_readiness_score_buckets(uuid) to authenticated, service_role;

-- Panel 4: requirements-engine outcomes (project_permit_requirements,
-- 20260806000026/27). matched/unresolved are mutually exclusive by that
-- table's own CHECK constraint (project_permit_requirements_matched_or_unresolved);
-- with_warnings is a subset of matched (only a matched row can carry a
-- non-empty warnings array -- R.3's "warnings populated when a matched
-- requirement isn't verified"). Single-table filtered counts, RLS-scoped via
-- project_permit_requirements_select's existing is_org_member(org_id)
-- policy (20260806000026).
create or replace function dashboard_requirements_summary(p_org_id uuid)
returns table (matched bigint, unresolved bigint, with_warnings bigint)
language sql
stable
as $$
  select
    count(*) filter (where permit_requirement_id is not null) as matched,
    count(*) filter (where unresolved_reason is not null) as unresolved,
    count(*) filter (
      where permit_requirement_id is not null
        and jsonb_array_length(warnings) > 0
    ) as with_warnings
  from project_permit_requirements
  where org_id = p_org_id;
$$;

grant execute on function dashboard_requirements_summary(uuid) to authenticated, service_role;

-- Panel 5: document review status (application_documents.status,
-- document_review_status enum: pending/approved/rejected, 20260806000024).
-- application_documents has no org_id column of its own (membership is
-- resolved through its parent application, same fact
-- application_documents_select's own comment states, 20260806000006 L75-76)
-- -- this function joins to permit_applications for the org filter, mirroring
-- that RLS policy's own EXISTS shape exactly. archived_at is null excludes
-- soft-deleted documents from the count, same scoping
-- document_revisions.test.sql's own fixtures assume. RLS-scoped via
-- application_documents_select's existing EXISTS(...is_org_member(pa.org_id))
-- policy.
create or replace function dashboard_document_review_counts(p_org_id uuid)
returns table (status document_review_status, count bigint)
language sql
stable
as $$
  select ad.status, count(*)
  from application_documents ad
  join permit_applications pa on pa.id = ad.application_id
  where pa.org_id = p_org_id
    and ad.archived_at is null
  group by ad.status;
$$;

grant execute on function dashboard_document_review_counts(uuid) to authenticated, service_role;
