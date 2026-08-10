-- Lifecycle & Compliance Expansion, Gate 1.6 deferred work: the deterministic
-- evaluator itself, the review RPC, and the two prerequisite input columns
-- SS3.4's own field list needs but the shipped schema (20260806000026)
-- doesn't yet have. Additive only against every prior migration: no existing
-- column, row, or enum value is renamed, retyped, or removed.
--
-- Architecture citation: PHASE_0_FINDINGS.md SS Q (deferred-work pre-branch
-- addendum) and SS R (the matching-algorithm addendum, written after SS Q's
-- approval, before any code on this branch):
--   Q.1 -- projects.estimated_construction_value_cents bigint, nullable,
--         additive. Corrects SS P.4's original "construction value is
--         already covered by permit_applications.estimated_job_value_cents"
--         claim -- that column lives on a row gated by permit_type_id, which
--         doesn't exist until after this engine has already run. Unset is an
--         explicit unresolved_question, never a default of 0.
--   Q.2 -- properties.jurisdiction_id uuid references jurisdictions(id),
--         nullable, additive, human-selected only. Fuzzy-matching free-text
--         city/province against jurisdictions.municipality/province_code was
--         considered and rejected as a guess dressed up as a lookup.
--   Q.3 -- evaluate_project_permit_requirements writes are append-only, each
--         call stamping every row it inserts with one gen_random_uuid()
--         evaluation_run_id (no column default -- the RPC controls it, not
--         Postgres). Already-reviewed rows are never touched by a later run.
--   Q.4 -- review_project_permit_requirement(p_id uuid), modeled directly on
--         override_readiness_check() (20260806000025): SECURITY DEFINER,
--         explicit org-membership + permit_manager+ role check, sets
--         reviewed_by/reviewed_at/preliminary, writes an audit_logs row.
--   Q.5 -- the deterministic core is split: match_permit_requirements(...) is
--         a pure, stateless, no-write function the 100-iteration determinism
--         test (supabase/tests/permit_requirements_engine.test.sql, this same
--         branch) calls directly; evaluate_project_permit_requirements(...)
--         is a thin wrapper that gathers a project's live inputs and persists
--         results.
--   Q.6 -- entitlement key 'jurisdiction.requirements', wired into
--         lib/entitlements/index.ts in a follow-up commit on this branch (no
--         DB dependency, not part of this migration).
--   R.1 -- Design B: unresolved rows are project/dimension-level
--         ('jurisdiction_not_set', 'property_type_not_selected',
--         'work_type_not_selected', 'occupancy_use_not_selected',
--         'construction_value_not_set'), scoped to dimensions actually
--         referenced by a candidate jurisdiction_permit_rules row in the
--         project's jurisdiction -- not per-catalog-row, since
--         project_permit_requirements_matched_or_unresolved
--         (20260806000026 L384-387) forbids an unresolved row from carrying
--         permit_requirement_id/jurisdiction_permit_rule_id, and reopening
--         that already-merged constraint was explicitly rejected. A missing
--         properties.jurisdiction_id (directly, or via a project with no
--         property_id set at all) short-circuits to a single
--         'jurisdiction_not_set' row before any rule is evaluated. Scope
--         attributes are NOT part of this unset-dimension check -- an empty/
--         absent project_taxonomy_selections set for kind = 'scope_attribute'
--         is treated as "no attributes" (a known, valid state; scope
--         attributes are multi-valued and optional by the shipped schema's
--         own "no uniqueness constraint on scope_attribute rows" design,
--         20260806000026 L109-113), not as an unanswered question the way an
--         unset single-select dimension is.
--   R.2 -- tie-break when multiple jurisdiction_permit_rules rows under the
--         same permit_requirement_id all definitely match: priority desc,
--         created_at asc, id asc.
--   R.3 -- a matched row whose permit_requirements.verification_status <>
--         'verified' gets a warnings entry; fee_cents/processing_estimate_*
--         remain joinable, the warning is the signal not to render them as
--         authoritative (SS3.4: "verified fees only, verified processing
--         estimates only").
--   R.4 -- evaluation_inputs is a flat, code-keyed snapshot (taxonomy codes,
--         not ids -- matches jurisdiction_permit_rules' own choice,
--         20260806000026 L270-279).
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently decided):
--   - No route or Server Action calls either RPC yet. Both are reachable via
--     supabase-js's .rpc() the moment PERMITFIELD_FF_REQUIREMENTS is flipped
--     on; wiring a UI call site is separate, future work.
--   - review_project_permit_requirement() refuses to review a row whose
--     permit_requirement_id is null (an unresolved row) -- "review" means
--     confirming a matched requirement is correct; there is nothing to
--     confirm on a row that only says "we don't know yet." Not part of
--     Q.4/R's original scoping, added here as the obvious consequence of
--     Q.4's own constraint, not a silent scope change.
--   - No backfill of properties.jurisdiction_id or
--     projects.estimated_construction_value_cents for existing rows -- both
--     start NULL, same as every other additive nullable column this schema
--     has ever added.
-- ---------------------------------------------------------------------------

-- Q.1: prerequisite evaluator input. See header comment for why
-- permit_applications.estimated_job_value_cents cannot serve this purpose.
alter table projects
  add column estimated_construction_value_cents bigint
    check (estimated_construction_value_cents >= 0);

-- Q.2: prerequisite evaluator input. Human-selected only -- see header
-- comment for why fuzzy address matching was rejected.
alter table properties
  add column jurisdiction_id uuid references jurisdictions(id);

create index properties_jurisdiction_id_idx on properties (jurisdiction_id);

-- Q.3: append-only write semantics. No default -- evaluate_project_permit_requirements()
-- below generates exactly one gen_random_uuid() per call and stamps every row
-- that call inserts with it, so "latest batch for this project" is always a
-- well-defined query (max(evaluated_at) or max(created_at) grouped by
-- evaluation_run_id). Not null, no default: this table has zero writers today
-- (20260806000026's own header comment -- no RPC has ever existed to write to
-- it), so every environment's project_permit_requirements is empty and a
-- NOT NULL column with no default is safe to add without a backfill.
alter table project_permit_requirements
  add column evaluation_run_id uuid not null;

create index project_permit_requirements_evaluation_run_id_idx
  on project_permit_requirements (evaluation_run_id);
create index project_permit_requirements_project_run_idx
  on project_permit_requirements (org_id, project_id, evaluation_run_id);

-- ---------------------------------------------------------------------------
-- match_permit_requirements: the pure, stateless matching core (Q.5). Takes
-- a project's classification inputs as plain arguments (not a project_id --
-- that indirection belongs to the wrapper below), returns the set of
-- (permit_requirement_id, jurisdiction_permit_rule_id, unresolved_reason)
-- tuples the wrapper should persist. No table writes, no side effects --
-- callable directly and repeatedly for the 100-iteration determinism test
-- without touching project_permit_requirements at all.
-- ---------------------------------------------------------------------------
create type permit_requirement_match_result as (
  permit_requirement_id uuid,
  jurisdiction_permit_rule_id uuid,
  unresolved_reason text
);

create or replace function match_permit_requirements(
  p_jurisdiction_id uuid,
  p_property_type_code text,
  p_work_type_code text,
  p_occupancy_use_code text,
  p_scope_attribute_codes text[],
  p_construction_value_cents bigint
)
returns setof permit_requirement_match_result
language plpgsql
stable
as $$
declare
  v_property_type_relevant boolean;
  v_work_type_relevant boolean;
  v_occupancy_use_relevant boolean;
  v_construction_value_relevant boolean;
  v_missing_dimension text;
  v_any_missing boolean := false;
  v_requirement record;
  v_rule_id uuid;
begin
  -- R.1: jurisdiction is a hard gate. Without it we cannot even select which
  -- permit_requirements rows are in scope, so nothing else can run.
  if p_jurisdiction_id is null then
    return next (null, null, 'jurisdiction_not_set')::permit_requirement_match_result;
    return;
  end if;

  -- R.1: scope the unset-dimension check to dimensions a candidate rule in
  -- this jurisdiction actually references -- never force a value for a
  -- dimension nothing here cares about.
  select
    exists (
      select 1 from jurisdiction_permit_rules jpr
      join permit_requirements pr on pr.id = jpr.permit_requirement_id
      where pr.jurisdiction_id = p_jurisdiction_id
        and pr.archived_at is null and jpr.archived_at is null
        and jpr.property_type_code is not null
    ),
    exists (
      select 1 from jurisdiction_permit_rules jpr
      join permit_requirements pr on pr.id = jpr.permit_requirement_id
      where pr.jurisdiction_id = p_jurisdiction_id
        and pr.archived_at is null and jpr.archived_at is null
        and jpr.work_type_code is not null
    ),
    exists (
      select 1 from jurisdiction_permit_rules jpr
      join permit_requirements pr on pr.id = jpr.permit_requirement_id
      where pr.jurisdiction_id = p_jurisdiction_id
        and pr.archived_at is null and jpr.archived_at is null
        and jpr.occupancy_use_code is not null
    ),
    exists (
      select 1 from jurisdiction_permit_rules jpr
      join permit_requirements pr on pr.id = jpr.permit_requirement_id
      where pr.jurisdiction_id = p_jurisdiction_id
        and pr.archived_at is null and jpr.archived_at is null
        and (jpr.min_construction_value_cents is not null or jpr.max_construction_value_cents is not null)
    )
  into v_property_type_relevant, v_work_type_relevant, v_occupancy_use_relevant, v_construction_value_relevant;

  for v_missing_dimension in
    select unnest(array[
      case when v_property_type_relevant and p_property_type_code is null then 'property_type_not_selected' end,
      case when v_work_type_relevant and p_work_type_code is null then 'work_type_not_selected' end,
      case when v_occupancy_use_relevant and p_occupancy_use_code is null then 'occupancy_use_not_selected' end,
      case when v_construction_value_relevant and p_construction_value_cents is null then 'construction_value_not_set' end
    ])
  loop
    if v_missing_dimension is not null then
      v_any_missing := true;
      return next (null, null, v_missing_dimension)::permit_requirement_match_result;
    end if;
  end loop;

  -- R.1: a relevant-but-unset dimension stops rule evaluation entirely for
  -- this run -- mixing "here's what matched" with "here's what we couldn't
  -- determine yet" in the same batch would be misleading, not just less
  -- precise.
  if v_any_missing then
    return;
  end if;

  -- All dimensions any candidate rule cares about are now known. Every
  -- match/mismatch below is definite -- no indeterminate case remains.
  -- order by id: no ORDER BY here would leave row-scan order (seq scan vs.
  -- index scan, vacuum state, etc.) unspecified by Postgres -- harmless for
  -- correctness (every requirement is still visited exactly once) but the
  -- 100-iteration determinism test needs a stable row order to compare
  -- against, not just a stable row *set*.
  for v_requirement in
    select id from permit_requirements
    where jurisdiction_id = p_jurisdiction_id and archived_at is null
    order by id
  loop
    select jpr.id into v_rule_id
    from jurisdiction_permit_rules jpr
    where jpr.permit_requirement_id = v_requirement.id
      and jpr.archived_at is null
      and (jpr.property_type_code is null or jpr.property_type_code = p_property_type_code)
      and (jpr.work_type_code is null or jpr.work_type_code = p_work_type_code)
      and (jpr.occupancy_use_code is null or jpr.occupancy_use_code = p_occupancy_use_code)
      and (
        jpr.required_scope_attribute_codes is null
        or jpr.required_scope_attribute_codes <@ coalesce(p_scope_attribute_codes, array[]::text[])
      )
      and (jpr.min_construction_value_cents is null or p_construction_value_cents >= jpr.min_construction_value_cents)
      and (jpr.max_construction_value_cents is null or p_construction_value_cents <= jpr.max_construction_value_cents)
    order by jpr.priority desc, jpr.created_at asc, jpr.id asc
    limit 1;

    -- R.1: zero matching rules for this requirement is "no rule found," a
    -- valid, visible-by-omission output (SS3.4) -- not returned as a row at
    -- all, matched or unresolved.
    if v_rule_id is not null then
      return next (v_requirement.id, v_rule_id, null)::permit_requirement_match_result;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function match_permit_requirements(uuid, text, text, text, text[], bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- evaluate_project_permit_requirements: gathers a project's live inputs,
-- calls match_permit_requirements(), persists the results (Q.3: append-only,
-- one evaluation_run_id per call). SECURITY DEFINER because
-- project_permit_requirements has no INSERT policy/grant for `authenticated`
-- (20260806000026's own "does NOT do" section) -- same posture as
-- override_readiness_check(). No special role required to trigger an
-- evaluation (unlike review, below) -- SS3.4 does not restrict who may run
-- the engine, only who may review its output; any org member may re-evaluate
-- their own project's requirements.
-- ---------------------------------------------------------------------------
create or replace function evaluate_project_permit_requirements(p_project_id uuid)
returns setof project_permit_requirements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects;
  v_jurisdiction_id uuid;
  v_property_type_code text;
  v_work_type_code text;
  v_occupancy_use_code text;
  v_scope_attribute_codes text[];
  v_run_id uuid := gen_random_uuid();
  v_inputs jsonb;
  v_match permit_requirement_match_result;
  v_warnings jsonb;
  v_verification_status permit_requirement_verification_status;
  v_row project_permit_requirements;
begin
  select * into v_project from projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'project % not found', p_project_id;
  end if;

  if not is_org_member(v_project.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Q.2: jurisdiction lives on properties, reached via projects.property_id
  -- (nullable -- a project may have no property yet, in which case
  -- v_jurisdiction_id stays null and match_permit_requirements() short-
  -- circuits to 'jurisdiction_not_set', same as an explicit unset FK would).
  if v_project.property_id is not null then
    select jurisdiction_id into v_jurisdiction_id
    from properties
    where org_id = v_project.org_id and id = v_project.property_id;
  end if;

  select t.code into v_property_type_code
  from project_taxonomy_selections pts
  join taxonomies t on t.org_id = pts.org_id and t.id = pts.taxonomy_id
  where pts.org_id = v_project.org_id and pts.project_id = p_project_id and pts.kind = 'property_type';

  select t.code into v_work_type_code
  from project_taxonomy_selections pts
  join taxonomies t on t.org_id = pts.org_id and t.id = pts.taxonomy_id
  where pts.org_id = v_project.org_id and pts.project_id = p_project_id and pts.kind = 'work_type';

  select t.code into v_occupancy_use_code
  from project_taxonomy_selections pts
  join taxonomies t on t.org_id = pts.org_id and t.id = pts.taxonomy_id
  where pts.org_id = v_project.org_id and pts.project_id = p_project_id and pts.kind = 'occupancy_use';

  select coalesce(array_agg(t.code order by t.code), array[]::text[]) into v_scope_attribute_codes
  from project_taxonomy_selections pts
  join taxonomies t on t.org_id = pts.org_id and t.id = pts.taxonomy_id
  where pts.org_id = v_project.org_id and pts.project_id = p_project_id and pts.kind = 'scope_attribute';

  -- R.4: flat, code-keyed snapshot -- the audit trail of what the engine saw,
  -- independent of whatever project_taxonomy_selections says by the time
  -- someone reviews this output later.
  v_inputs := jsonb_build_object(
    'jurisdiction_id', v_jurisdiction_id,
    'property_type_code', v_property_type_code,
    'work_type_code', v_work_type_code,
    'occupancy_use_code', v_occupancy_use_code,
    'scope_attribute_codes', to_jsonb(v_scope_attribute_codes),
    'construction_value_cents', v_project.estimated_construction_value_cents
  );

  for v_match in
    select * from match_permit_requirements(
      v_jurisdiction_id,
      v_property_type_code,
      v_work_type_code,
      v_occupancy_use_code,
      v_scope_attribute_codes,
      v_project.estimated_construction_value_cents
    )
  loop
    v_warnings := '[]'::jsonb;

    -- R.3: matched-but-unverified requirements carry a warning; fee/
    -- processing-estimate columns stay joinable but should not be rendered
    -- as authoritative without checking this.
    if v_match.permit_requirement_id is not null then
      select verification_status into v_verification_status
      from permit_requirements where id = v_match.permit_requirement_id;

      if v_verification_status <> 'verified' then
        v_warnings := jsonb_build_array(jsonb_build_object(
          'code', 'unverified_requirement',
          'message', 'Fee and processing estimates for this requirement have not been verified; contact the jurisdiction directly.'
        ));
      end if;
    end if;

    insert into project_permit_requirements (
      org_id, project_id, permit_requirement_id, jurisdiction_permit_rule_id,
      unresolved_reason, warnings, evaluation_inputs, evaluation_run_id, evaluated_at
    )
    values (
      v_project.org_id, p_project_id, v_match.permit_requirement_id, v_match.jurisdiction_permit_rule_id,
      v_match.unresolved_reason, v_warnings, v_inputs, v_run_id, now()
    )
    returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

grant execute on function evaluate_project_permit_requirements(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- review_project_permit_requirement: Q.4, modeled directly on
-- override_readiness_check() (20260806000025). SECURITY DEFINER; explicit
-- org-membership + permit_manager+ role check (same permit_status_tier()-
-- derived list); flips preliminary/reviewed_by/reviewed_at; writes an
-- audit_logs row.
-- ---------------------------------------------------------------------------
create or replace function review_project_permit_requirement(p_id uuid)
returns project_permit_requirements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row project_permit_requirements;
  v_role org_role;
begin
  select * into v_row from project_permit_requirements where id = p_id;
  if v_row.id is null then
    raise exception 'project_permit_requirement % not found', p_id;
  end if;

  if not is_org_member(v_row.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select role into v_role from org_members where org_id = v_row.org_id and user_id = auth.uid();

  if v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not review permit requirements (requires permit_manager or above)', v_role
      using errcode = '42501';
  end if;

  -- See this migration's header comment ("does NOT do"): reviewing an
  -- unresolved row (no matched requirement) has nothing to confirm.
  if v_row.permit_requirement_id is null then
    raise exception 'cannot review an unresolved row (id %) -- only matched requirements can be reviewed', p_id
      using errcode = '22023';
  end if;

  update project_permit_requirements
  set reviewed_by = auth.uid(),
      reviewed_at = now(),
      preliminary = false
  where id = p_id
  returning * into v_row;

  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  values (
    v_row.org_id,
    auth.uid(),
    v_role,
    'permit_requirement_reviewed',
    'project_permit_requirement',
    v_row.id,
    jsonb_build_object('permit_requirement_id', v_row.permit_requirement_id)
  );

  return v_row;
end;
$$;

grant execute on function review_project_permit_requirement(uuid) to authenticated, service_role;
