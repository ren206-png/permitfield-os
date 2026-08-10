-- Lifecycle & Compliance Expansion, Gate 1.6 deferred work
-- (20260806000027_permit_requirements_evaluator.sql). Proves:
--   1. match_permit_requirements() -- the pure matching core (Q.5) --
--      against a known catalog fixture:
--        a. jurisdiction_id null short-circuits to a single
--           'jurisdiction_not_set' row (R.1).
--        b. Relevant-but-unset dimensions (property_type, work_type,
--           construction_value -- each referenced by a fixture rule below)
--           each produce their own unresolved row, and evaluation stops
--           before any rule is matched (R.1). occupancy_use is NOT one of
--           these rows even though it's also unset, because no fixture rule
--           references occupancy_use_code -- proving the "only dimensions a
--           candidate rule actually cares about" scoping, not "every unset
--           dimension".
--        c. A full-input run returns exactly the requirements with a
--           matching rule (tie-broken priority desc / created_at asc / id
--           asc per R.2) and silently omits a requirement whose only rule
--           doesn't match and one with zero rules at all -- "no rule found"
--           is omission, not a row (SS3.4).
--        d. 100 successive calls with identical inputs return identical,
--           identically-ORDERED output (Q.5's determinism requirement).
--   2. evaluate_project_permit_requirements(p_project_id): gathers a real
--      project's live inputs, persists matched/unresolved rows stamped with
--      one evaluation_run_id per call (Q.3), attaches an unverified_requirement
--      warning to a matched-but-unverified requirement (R.3), snapshots
--      evaluation_inputs by taxonomy code (R.4), is append-only across two
--      calls (Q.3), and is blocked for a non-member (42501).
--   3. review_project_permit_requirement(p_id): unauthorized role rejected
--      (42501), an unresolved row rejected (22023, this migration's own
--      addition beyond Q.4), a valid call succeeds and writes an audit_logs
--      row (mirrors readiness_checklist.test.sql SS5's override-path
--      structure).
--
-- HOW TO RUN: see readiness_checklist.test.sql's header (supabase start,
-- supabase db reset, then either a direct psql -f invocation or
-- `npm run test:sql` to run this alongside every other supabase/tests/*.test.sql
-- file). Runs automatically on every push/PR via .github/workflows/ci.yml's
-- sql-tests job.

begin;

-- ============================================================
-- PART 1: fixtures
-- ============================================================
-- Reuses Org A/B from supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b
-- Reuses the seeded Toronto jurisdiction (00000000-0000-0000-0001-000000000001)
-- and its permit_type (00000000-0000-0000-0003-000000000001). Everything
-- else -- users, taxonomies, properties, projects, the permit_requirements/
-- jurisdiction_permit_rules catalog -- is fixture data dedicated to this
-- file, same as every other supabase/tests/*.test.sql file, inserted before
-- any `set local role authenticated` switch so RLS (permit_requirements/
-- jurisdiction_permit_rules INSERT is_platform_admin()-gated) doesn't block
-- fixture setup.

-- Dedicated permit_manager/member fixture users for Org A, same pattern as
-- readiness_checklist.test.sql's 050/051 (different literal ids -- each
-- test file runs in its own begin/rollback transaction via its own psql -f
-- invocation, so collisions are harmless either way, but distinct ids keep
-- error output unambiguous about which file a fixture belongs to).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000060', 'authenticated', 'authenticated',
   'requirements-permit-manager@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000061', 'authenticated', 'authenticated',
   'requirements-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000060', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000061', 'member')
on conflict (org_id, user_id) do nothing;

-- Taxonomy rows for the four new kinds (none exist in seed.sql -- its own
-- header notes only 'project_type' is seeded, 20260806000019 L179-181).
-- Org A only; Org B is not used for classification-dependent scenarios,
-- only for the tenant-isolation checks in PART 3.
insert into taxonomies (org_id, kind, code, label, sort_order, is_seed) values
  ('20000000-0000-0000-0000-00000000000a', 'property_type', 'residential', 'Residential', 1, false),
  ('20000000-0000-0000-0000-00000000000a', 'property_type', 'commercial', 'Commercial', 2, false),
  ('20000000-0000-0000-0000-00000000000a', 'work_type', 'electrical', 'Electrical', 1, false),
  ('20000000-0000-0000-0000-00000000000a', 'work_type', 'plumbing', 'Plumbing', 2, false),
  ('20000000-0000-0000-0000-00000000000a', 'occupancy_use', 'single_family', 'Single Family', 1, false),
  ('20000000-0000-0000-0000-00000000000a', 'scope_attribute', 'service_upgrade', 'Service Upgrade', 1, false)
on conflict (org_id, kind, code) do nothing;

-- A verified jurisdiction_sources row (Toronto) to serve as source_id for
-- the one "verified" permit_requirements fixture below -- the fee/estimate
-- warning path (R.3) needs both a verified and an unverified requirement to
-- distinguish "warning present" from "warning absent".
insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, verification_status, verified_at, verified_by)
values ('72000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'fee_schedule',
        'https://www.toronto.ca/fee-schedule-test-fixture', 'verified', now(), '10000000-0000-0000-0000-000000000060')
on conflict (id) do nothing;

-- properties: one Toronto-linked property for Org A (Q.2).
insert into properties (id, org_id, address_line1, city, province_code, postal_code, jurisdiction_id)
values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a',
        '1 Requirements Test St', 'Toronto', 'ON', 'M5V 1A1', '00000000-0000-0000-0001-000000000001')
on conflict (id) do nothing;

-- Two dedicated Org A projects (not the shared seed.sql project, to keep
-- this file fully self-contained): #070 will be fully classified (used for
-- the successful-evaluation / review-success scenarios), #071 deliberately
-- leaves work_type unset (used for the unresolved-row / review-rejection
-- scenario in PART 3).
insert into projects (id, org_id, property_id, title, status, estimated_construction_value_cents)
values
  ('50000000-0000-0000-0000-000000000070', '20000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001',
   'Requirements Test Project (fully classified)', 'draft', 5000000),
  ('50000000-0000-0000-0000-000000000071', '20000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001',
   'Requirements Test Project (work_type unset)', 'draft', 5000000)
on conflict (id) do nothing;

insert into project_taxonomy_selections (org_id, project_id, taxonomy_id, kind)
select '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000070', t.id, t.kind
from taxonomies t
where t.org_id = '20000000-0000-0000-0000-00000000000a'
  and (t.kind, t.code) in (('property_type', 'residential'), ('work_type', 'electrical'), ('scope_attribute', 'service_upgrade'));

-- Project #071: property_type set, work_type deliberately left unset.
insert into project_taxonomy_selections (org_id, project_id, taxonomy_id, kind)
select '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000071', t.id, t.kind
from taxonomies t
where t.org_id = '20000000-0000-0000-0000-00000000000a'
  and (t.kind, t.code) in (('property_type', 'residential'));

-- permit_requirements catalog (all Toronto, all using the seeded permit_type):
--   PR_electrical: verified, two candidate rules (tie-break fixture, R.2).
--   PR_plumbing: unverified (default), one construction-value-gated rule
--     (R.3 warning fixture).
--   PR_commercial_only: unverified, one rule that requires property_type
--     'commercial' -- never matches project #070 (residential), proving
--     "no matching rule" is silent omission (SS3.4), and makes property_type
--     a "relevant" dimension for the unset-dimension tests in PART 2b.
--   PR_no_rules: unverified, zero jurisdiction_permit_rules rows at all --
--     same "silent omission" proof via the zero-candidate-rules path.
insert into permit_requirements (id, jurisdiction_id, permit_type_id, title, verification_status, verified_at, verified_by, source_id)
values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
   'Electrical Permit', 'verified', now(), '10000000-0000-0000-0000-000000000060', '72000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
   'Plumbing Permit', 'unverified', null, null, null),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
   'Commercial-Only Permit', 'unverified', null, null, null),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001',
   'Never-Matched Permit (no rules)', 'unverified', null, null, null)
on conflict (id) do nothing;

-- jurisdiction_permit_rules: two rules under PR_electrical for the R.2
-- tie-break assertion (rule B has higher priority AND requires the scope
-- attribute the fixture project actually has, so it should win over rule A
-- on priority alone even though both definitely match); one rule under
-- PR_plumbing gated on construction value; one rule under PR_commercial_only
-- gated on a property_type that never matches project #070.
insert into jurisdiction_permit_rules (id, permit_requirement_id, work_type_code, required_scope_attribute_codes, priority)
values
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'electrical', null, 0),
  ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'electrical', array['service_upgrade'], 10)
on conflict (id) do nothing;

insert into jurisdiction_permit_rules (id, permit_requirement_id, min_construction_value_cents, priority)
values ('71000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 1000000, 0)
on conflict (id) do nothing;

insert into jurisdiction_permit_rules (id, permit_requirement_id, property_type_code, priority)
values ('71000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000003', 'commercial', 0)
on conflict (id) do nothing;

-- ============================================================
-- PART 2: match_permit_requirements() -- the pure matching core
-- ============================================================

-- 2a. jurisdiction_id null short-circuits to a single 'jurisdiction_not_set'
-- row, nothing else evaluated.
do $$
declare
  row_count int;
  r record;
begin
  select count(*) into row_count from match_permit_requirements(null, 'residential', 'electrical', null, array['service_upgrade'], 5000000);
  if row_count <> 1 then
    raise exception 'FAIL: expected exactly 1 row for a null jurisdiction_id, got %', row_count;
  end if;

  select * into r from match_permit_requirements(null, 'residential', 'electrical', null, array['service_upgrade'], 5000000);
  if r.unresolved_reason <> 'jurisdiction_not_set' or r.permit_requirement_id is not null or r.jurisdiction_permit_rule_id is not null then
    raise exception 'FAIL: null jurisdiction_id row was not a clean jurisdiction_not_set row: %', r;
  end if;
  raise notice 'PASS: null jurisdiction_id short-circuits to a single jurisdiction_not_set row';
end $$;

-- 2b. Relevant-but-unset dimensions: property_type, work_type, and
-- construction_value are each unset and each referenced by a fixture rule
-- above, so each must produce its own unresolved row -- occupancy_use is
-- also unset but referenced by NO fixture rule, so it must NOT appear.
do $$
declare
  reasons text[];
begin
  select array_agg(unresolved_reason order by unresolved_reason)
  into reasons
  from match_permit_requirements('00000000-0000-0000-0001-000000000001', null, null, null, null, null);

  if reasons is distinct from array['construction_value_not_set', 'property_type_not_selected', 'work_type_not_selected'] then
    raise exception 'FAIL: expected exactly [construction_value_not_set, property_type_not_selected, work_type_not_selected], got %', reasons;
  end if;
  raise notice 'PASS: only relevant-and-unset dimensions are reported (occupancy_use correctly excluded, no fixture rule references it)';
end $$;

-- 2c. Full-input run: exactly the requirements with a matching rule are
-- returned; the tie-break picks the higher-priority rule; the
-- property-type-mismatched and zero-rule requirements are silently omitted.
do $$
declare
  results permit_requirement_match_result[];
  electrical_rule uuid;
  plumbing_rule uuid;
  total int;
begin
  select array_agg(t) into results
  from match_permit_requirements(
    '00000000-0000-0000-0001-000000000001', 'residential', 'electrical', null,
    array['service_upgrade'], 5000000
  ) t;

  total := array_length(results, 1);
  if total <> 2 then
    raise exception 'FAIL: expected exactly 2 matched rows (electrical + plumbing), got % (%: %)', total, total, results;
  end if;

  select jurisdiction_permit_rule_id into electrical_rule
  from unnest(results) t where t.permit_requirement_id = '70000000-0000-0000-0000-000000000001';
  if electrical_rule <> '71000000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: expected the priority-10 rule (...002) to win the tie-break for PR_electrical, got %', electrical_rule;
  end if;

  select jurisdiction_permit_rule_id into plumbing_rule
  from unnest(results) t where t.permit_requirement_id = '70000000-0000-0000-0000-000000000002';
  if plumbing_rule <> '71000000-0000-0000-0000-000000000003' then
    raise exception 'FAIL: expected PR_plumbing to match its construction-value rule (...003), got %', plumbing_rule;
  end if;

  if exists (select 1 from unnest(results) t where t.permit_requirement_id = '70000000-0000-0000-0000-000000000003') then
    raise exception 'FAIL: PR_commercial_only should have been silently omitted (property_type mismatch), but appeared in results';
  end if;

  if exists (select 1 from unnest(results) t where t.permit_requirement_id = '70000000-0000-0000-0000-000000000004') then
    raise exception 'FAIL: PR_no_rules should have been silently omitted (zero candidate rules), but appeared in results';
  end if;

  raise notice 'PASS: full-input run returns exactly the 2 rule-matched requirements, tie-break correct (priority desc), non-matches silently omitted';
end $$;

-- 2d. Determinism: 100 successive calls with identical inputs return
-- identical, identically-ordered output (Q.5).
do $$
declare
  baseline text;
  candidate text;
  i int;
begin
  select string_agg(format('%s|%s|%s', permit_requirement_id, jurisdiction_permit_rule_id, unresolved_reason), ',' order by ord)
  into baseline
  from match_permit_requirements(
    '00000000-0000-0000-0001-000000000001', 'residential', 'electrical', null,
    array['service_upgrade'], 5000000
  ) with ordinality as t(permit_requirement_id, jurisdiction_permit_rule_id, unresolved_reason, ord);

  if baseline is null or baseline = '' then
    raise exception 'FAIL: determinism baseline run produced no rows';
  end if;

  for i in 1..100 loop
    select string_agg(format('%s|%s|%s', permit_requirement_id, jurisdiction_permit_rule_id, unresolved_reason), ',' order by ord)
    into candidate
    from match_permit_requirements(
      '00000000-0000-0000-0001-000000000001', 'residential', 'electrical', null,
      array['service_upgrade'], 5000000
    ) with ordinality as t(permit_requirement_id, jurisdiction_permit_rule_id, unresolved_reason, ord);

    if candidate is distinct from baseline then
      raise exception 'FAIL: determinism broken on iteration %: baseline=[%] candidate=[%]', i, baseline, candidate;
    end if;
  end loop;

  raise notice 'PASS: 100/100 successive match_permit_requirements() calls with identical inputs returned identical, identically-ordered output';
end $$;

-- ============================================================
-- PART 3: evaluate_project_permit_requirements() and
-- review_project_permit_requirement(), under RLS as `authenticated`
-- ============================================================

-- 3a. Non-member cannot evaluate Org A's project.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
begin
  begin
    perform evaluate_project_permit_requirements('50000000-0000-0000-0000-000000000070');
    raise exception 'FAIL: Org B owner was able to evaluate Org A''s project';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: non-member correctly rejected on evaluate_project_permit_requirements() with insufficient_privilege (%)', sqlerrm;
  end;
end $$;

-- 3b. Org A member evaluates project #070 (fully classified): 2 matched
-- rows, one evaluation_run_id shared across them, plumbing (unverified)
-- carries the R.3 warning, electrical (verified) does not, evaluation_inputs
-- matches R.4's shape.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  run_id_count int;
  distinct_run_ids int;
  electrical_warnings jsonb;
  plumbing_warnings jsonb;
  inputs jsonb;
begin
  perform evaluate_project_permit_requirements('50000000-0000-0000-0000-000000000070');

  select count(*), count(distinct evaluation_run_id)
  into run_id_count, distinct_run_ids
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070';

  if run_id_count <> 2 then
    raise exception 'FAIL: expected 2 project_permit_requirements rows after first evaluation, got %', run_id_count;
  end if;
  if distinct_run_ids <> 1 then
    raise exception 'FAIL: expected all rows from one call to share a single evaluation_run_id, saw % distinct', distinct_run_ids;
  end if;

  select warnings into electrical_warnings from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000001';
  if electrical_warnings <> '[]'::jsonb then
    raise exception 'FAIL: verified Electrical Permit should carry no warnings, got %', electrical_warnings;
  end if;

  select warnings into plumbing_warnings from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000002';
  if plumbing_warnings is null or jsonb_array_length(plumbing_warnings) <> 1
     or (plumbing_warnings -> 0 ->> 'code') <> 'unverified_requirement' then
    raise exception 'FAIL: unverified Plumbing Permit should carry exactly one unverified_requirement warning, got %', plumbing_warnings;
  end if;

  select evaluation_inputs into inputs from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000001';
  if inputs ->> 'jurisdiction_id' <> '00000000-0000-0000-0001-000000000001'
     or inputs ->> 'property_type_code' <> 'residential'
     or inputs ->> 'work_type_code' <> 'electrical'
     or inputs ->> 'occupancy_use_code' is not null
     or inputs -> 'scope_attribute_codes' <> '["service_upgrade"]'::jsonb
     or (inputs ->> 'construction_value_cents')::bigint <> 5000000 then
    raise exception 'FAIL: evaluation_inputs snapshot did not match R.4''s expected shape: %', inputs;
  end if;

  raise notice 'PASS: evaluate_project_permit_requirements() persisted 2 rows under 1 evaluation_run_id, warnings correct, evaluation_inputs matches R.4';
end $$;

-- 3c. Append-only: a second call produces a NEW evaluation_run_id and does
-- not touch the first run's rows.
do $$
declare
  first_run_id uuid;
  second_run_id uuid;
  total_rows int;
  first_run_still_present int;
begin
  select evaluation_run_id into first_run_id
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070'
  limit 1;

  perform evaluate_project_permit_requirements('50000000-0000-0000-0000-000000000070');

  select count(*) into total_rows
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070';
  if total_rows <> 4 then
    raise exception 'FAIL: expected 4 total rows after a second evaluation call (2 + 2, append-only), got %', total_rows;
  end if;

  select count(*) into first_run_still_present
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and evaluation_run_id = first_run_id;
  if first_run_still_present <> 2 then
    raise exception 'FAIL: first evaluation_run_id''s 2 rows were not left untouched by the second call, found %', first_run_still_present;
  end if;

  select evaluation_run_id into second_run_id
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and evaluation_run_id <> first_run_id
  limit 1;
  if second_run_id is null or second_run_id = first_run_id then
    raise exception 'FAIL: second call did not generate a distinct evaluation_run_id';
  end if;

  raise notice 'PASS: evaluate_project_permit_requirements() is append-only -- second call added a new evaluation_run_id, left the first run''s rows untouched';
end $$;

-- 3d. Tenant isolation on project_permit_requirements: Org B cannot see
-- Org A's rows.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070';
  if visible_count <> 0 then
    raise exception 'FAIL: Org B could see % of Org A''s project_permit_requirements rows', visible_count;
  end if;
  raise notice 'PASS: Org B cannot read Org A''s project_permit_requirements (is_org_member boundary holds)';
end $$;

-- 3e. Evaluate project #071 (work_type deliberately unset, but relevant) --
-- produces the unresolved row used by the review-rejection test below.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  unresolved_row_id uuid;
  reason text;
begin
  perform evaluate_project_permit_requirements('50000000-0000-0000-0000-000000000071');

  select id, unresolved_reason into unresolved_row_id, reason
  from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000071';

  if unresolved_row_id is null or reason <> 'work_type_not_selected' then
    raise exception 'FAIL: expected exactly 1 unresolved row (work_type_not_selected) for project #071, got id=% reason=%', unresolved_row_id, reason;
  end if;
  raise notice 'PASS: evaluate_project_permit_requirements() on a project missing a relevant dimension persisted a single work_type_not_selected row';
end $$;

-- === review_project_permit_requirement() ===

-- 4a. Unauthorized role (plain member) is rejected with insufficient_privilege.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000061","role":"authenticated"}';

do $$
declare
  target_id uuid;
begin
  select id into target_id from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000002'
  limit 1;

  begin
    perform review_project_permit_requirement(target_id);
    raise exception 'FAIL: plain member was able to call review_project_permit_requirement()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member correctly rejected on review_project_permit_requirement() with insufficient_privilege (%)', sqlerrm;
  end;
end $$;

-- 4b. Authorized role (permit_manager), but the target row is unresolved --
-- rejected with 22023 (this migration's own addition beyond Q.4's scope,
-- see its header comment).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000060","role":"authenticated"}';

do $$
declare
  target_id uuid;
begin
  select id into target_id from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000071' and unresolved_reason = 'work_type_not_selected'
  limit 1;

  begin
    perform review_project_permit_requirement(target_id);
    raise exception 'FAIL: review_project_permit_requirement() accepted an unresolved row';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: review_project_permit_requirement() correctly rejected an unresolved row with 22023 (%)', sqlerrm;
  end;
end $$;

-- 4c. Authorized role, matched row: succeeds, flips preliminary/reviewed_by/
-- reviewed_at.
do $$
declare
  target_id uuid;
  result project_permit_requirements;
begin
  select id into target_id from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000002'
  limit 1;

  select * into result from review_project_permit_requirement(target_id);

  if result.preliminary <> false or result.reviewed_by is null or result.reviewed_at is null then
    raise exception 'FAIL: review_project_permit_requirement() succeeded but left preliminary/reviewed_by/reviewed_at unset: %', result;
  end if;
  if result.reviewed_by <> '10000000-0000-0000-0000-000000000060' then
    raise exception 'FAIL: reviewed_by = %, expected the calling permit_manager''s user id', result.reviewed_by;
  end if;

  raise notice 'PASS: review_project_permit_requirement() succeeds for permit_manager on a matched row, flips preliminary/reviewed_by/reviewed_at';
end $$;

-- 4c-audit. Same "switch to a can_read_audit_logs() role to verify the
-- SECURITY DEFINER write" pattern as readiness_checklist.test.sql SS5c-audit
-- -- permit_manager itself is not in can_read_audit_logs()'s allowed list.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  audit_count int;
  target_id uuid;
begin
  select id into target_id from project_permit_requirements
  where project_id = '50000000-0000-0000-0000-000000000070' and permit_requirement_id = '70000000-0000-0000-0000-000000000002'
  limit 1;

  select count(*) into audit_count
  from audit_logs
  where entity_type = 'project_permit_requirement'
    and entity_id = target_id
    and action = 'permit_requirement_reviewed';
  if audit_count <> 1 then
    raise exception 'FAIL: expected exactly 1 audit_logs row for this review, found %', audit_count;
  end if;

  raise notice 'PASS: review_project_permit_requirement() wrote exactly 1 audit_logs row, visible to a can_read_audit_logs() role';
end $$;

rollback;
