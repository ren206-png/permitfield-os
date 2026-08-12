-- Lifecycle & Compliance Expansion, Gate 1.7. Proves, against the actual
-- `authenticated` Postgres role under RLS (not just "the function looks
-- right" -- see prior gates' adversarial self-checks), everything
-- 20260806000028_dashboard_queries.sql adds:
--   1. Correctness: each of the five dashboard_*() functions returns the
--      exact expected distribution against a known, hand-built fixture set
--      (project statuses, permit_status pipeline, readiness score buckets,
--      requirements-engine matched/unresolved/warnings, document review
--      status with archived exclusion).
--   2. Tenant isolation, both directions plus a control: Org A cannot see
--      Org B's counts and vice versa, even when a member of one org
--      explicitly passes the OTHER org's id as the p_org_id argument. A
--      control check (Part 1, run under the RLS-bypassing fixture-loading
--      role before any `set local role`) proves the bare `where org_id =
--      p_org_id` filter alone DOES match Org B's seeded data -- so the
--      later 0-row result once RLS is engaged is RLS actively blocking a
--      real match, not an empty match to begin with. Part 4 adds the
--      cleanest possible adversary on top of that: a third org's owner with
--      zero membership in EITHER Org A or Org B, querying both -- ruling out
--      any question of whether Org A's own membership row was doing
--      something the WHERE clause alone wouldn't. Together these prove RLS
--      (not just the functions' own WHERE clause) is what enforces the
--      boundary, same "RLS is the real gate" property compute_readiness_score()
--      already established (20260806000025) and this migration's header
--      comment claims for all five functions.
--   3. The readiness-score-buckets panel specifically reuses
--      compute_readiness_score() via a scalar subquery inside one query
--      (not a per-application call from application code) -- this test
--      cannot directly observe "how many round trips happened," but it does
--      prove the single SQL statement produces the same per-application
--      scores compute_readiness_score() itself would return, so the reuse
--      is behaviorally correct, not just structurally present.
--
-- HOW TO RUN:
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/dashboard_queries.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh). Also runs automatically on every push/PR
-- via .github/workflows/ci.yml's sql-tests job.

begin;

-- ============================================================
-- PART 1: fixtures (inserted as the migration/superuser role, before any
-- `set local role authenticated` below -- same ordering
-- permit_requirements_engine.test.sql's own Part 1 uses, so RLS never blocks
-- a fixture insert).
-- ============================================================

-- Reuses Org A/B owner fixtures from supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b
-- CORRECTION (confirmed by actually running this file, not just reading
-- seed.sql's comments): seed.sql DOES insert 1 project (status='draft') and
-- 1 permit_application (permit_status='intake') for EACH of Org A and Org B
-- (seed.sql L166-174, ids 50000000-...-00000000000a/b and
-- 40000000-...-00000000000a/b) -- an earlier draft of this comment claimed
-- otherwise and that claim was wrong (caught by dashboard_project_status_counts
-- returning draft:2 instead of the originally-expected draft:1 on first run).
-- seed.sql adds no application_documents/readiness_checklist_items/
-- project_permit_requirements rows, so those three panels' expected counts
-- below are unaffected -- but the project-status and permit-status panels'
-- expected distributions, and the readiness-score-buckets panel (the seeded
-- application has zero readiness_checklist_items, and
-- compute_readiness_score() defines "no required items" as 100/ready, so it
-- contributes one extra 'ready' row), all explicitly account for the one
-- extra seeded row per org. Each *.test.sql file still runs in its own
-- begin/rollback transaction, so there's no cross-file contamination --
-- only this file's own seed.sql baseline to account for.

-- --- Org A: 4 projects across 3 distinct statuses ---
insert into projects (id, org_id, contractor_id, title, status)
values
  ('50000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Dashboard Test Project C1 (draft)', 'draft'),
  ('50000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Dashboard Test Project C2 (active)', 'active'),
  ('50000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Dashboard Test Project C3 (active)', 'active'),
  ('50000000-0000-0000-0000-0000000000c4', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Dashboard Test Project C4 (completed)', 'completed');

-- --- Org A: 3 permit_applications across 3 distinct permit_status values ---
insert into permit_applications (id, org_id, project_id, contractor_id, permit_type_id, project_title, project_address, permit_status)
values
  ('40000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c1',
   '30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0003-000000000001',
   'Dashboard Test App C1 (intake)', '1 Dashboard Test St, Toronto, ON', 'intake'),
  ('40000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c2',
   '30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0003-000000000001',
   'Dashboard Test App C2 (ready_to_submit)', '2 Dashboard Test St, Toronto, ON', 'ready_to_submit'),
  ('40000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c3',
   '30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0003-000000000001',
   'Dashboard Test App C3 (issued)', '3 Dashboard Test St, Toronto, ON', 'issued');

-- --- Org A: readiness checklist items, 2 required items per application,
-- deliberately different completion ratios so each application lands in a
-- different score bucket: C1 = 100 (ready), C2 = 50 (in_progress), C3 = 0
-- (at_risk). ---
insert into readiness_checklist_items (org_id, application_id, title, is_required, status)
values
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', 'C1 item 1', true, 'complete'),
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c1', 'C1 item 2', true, 'complete'),
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c2', 'C2 item 1', true, 'complete'),
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c2', 'C2 item 2', true, 'pending'),
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c3', 'C3 item 1', true, 'pending'),
  ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000c3', 'C3 item 2', true, 'pending');

-- --- Org A: 2 permit_requirements catalog rows (global/jurisdiction-scoped,
-- same as permit_requirements_engine.test.sql's own fixtures) to reference
-- from project_permit_requirements below. ---
-- Both rows stay 'unverified': verification_status is irrelevant to the
-- dashboard_requirements_summary() panel (it counts matched/unresolved/
-- with_warnings, not verification state), and 'verified' would trip
-- permit_requirements_verified_requires_all_three (verified_at/verified_by/
-- source_id all required) for no test benefit.
insert into permit_requirements (id, jurisdiction_id, permit_type_id, title, verification_status)
values
  ('70000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'Dashboard Test Requirement C1', 'unverified'),
  ('70000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-000000000001', 'Dashboard Test Requirement C2', 'unverified');

-- --- Org A: 4 project_permit_requirements rows -- 2 matched (1 with a
-- warning, 1 without), 2 unresolved. Inserted directly (not via
-- evaluate_project_permit_requirements()) since this test only needs known
-- rows for the aggregate counts, not a real evaluation run. ---
-- evaluation_run_id is not null with no column default (20260806000027 L107 --
-- "the RPC controls it, not the column"), and these rows are inserted
-- directly rather than via evaluate_project_permit_requirements(), so a
-- fixture-only run id is supplied explicitly; its value is otherwise
-- irrelevant to this test.
insert into project_permit_requirements (org_id, project_id, permit_requirement_id, unresolved_reason, warnings, evaluation_inputs, evaluation_run_id)
values
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c1', '70000000-0000-0000-0000-0000000000c1', null,
   '[]'::jsonb, '{"jurisdiction_id": "00000000-0000-0000-0001-000000000001"}'::jsonb, '80000000-0000-0000-0000-0000000000d1'),
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c1', '70000000-0000-0000-0000-0000000000c2', null,
   '[{"code": "unverified_requirement", "message": "Fee and processing estimates have not been verified."}]'::jsonb,
   '{"jurisdiction_id": "00000000-0000-0000-0001-000000000001"}'::jsonb, '80000000-0000-0000-0000-0000000000d1'),
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c1', null, 'work_type_not_selected',
   '[]'::jsonb, '{"jurisdiction_id": "00000000-0000-0000-0001-000000000001"}'::jsonb, '80000000-0000-0000-0000-0000000000d1'),
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c2', null, 'jurisdiction_not_set',
   '[]'::jsonb, '{"jurisdiction_id": null}'::jsonb, '80000000-0000-0000-0000-0000000000d1');

-- --- Org A: 4 application_documents rows on app C1 -- pending/approved/
-- rejected, plus one archived row (archived_at set) that must be excluded
-- from the count. sha256 computed from distinct content so the
-- (application_id, sha256) unique constraint is trivially satisfied. ---
-- archived_by is required in lockstep with archived_at
-- (application_documents_archived_pair, 20260806000024 L101-102).
insert into application_documents (application_id, storage_path, original_filename, mime_type, byte_size, sha256, status, archived_at, archived_by)
values
  ('40000000-0000-0000-0000-0000000000c1', 'dashboard-test/c1-pending.pdf', 'c1-pending.pdf', 'application/pdf', 1024, encode(sha256('dashboard-test-doc-pending'::bytea), 'hex'), 'pending', null, null),
  ('40000000-0000-0000-0000-0000000000c1', 'dashboard-test/c1-approved.pdf', 'c1-approved.pdf', 'application/pdf', 1024, encode(sha256('dashboard-test-doc-approved'::bytea), 'hex'), 'approved', null, null),
  ('40000000-0000-0000-0000-0000000000c1', 'dashboard-test/c1-rejected.pdf', 'c1-rejected.pdf', 'application/pdf', 1024, encode(sha256('dashboard-test-doc-rejected'::bytea), 'hex'), 'rejected', null, null),
  ('40000000-0000-0000-0000-0000000000c1', 'dashboard-test/c1-archived.pdf', 'c1-archived.pdf', 'application/pdf', 1024, encode(sha256('dashboard-test-doc-archived'::bytea), 'hex'), 'pending', now(), '10000000-0000-0000-0000-00000000000a');

-- --- Org B: 1 project (draft) -- exists solely to prove Org A's counts
-- don't include it, and vice versa. ---
insert into projects (id, org_id, contractor_id, title, status)
values ('50000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'Dashboard Test Project D1 (draft, Org B)', 'draft');

-- --- Org E: a third org, with an owner who is a member of NEITHER Org A
-- nor Org B, used in Part 4 below to prove RLS -- not the functions' own
-- `where org_id = p_org_id` filter -- is what actually blocks cross-org
-- reads. A caller who is a member of Org A already has *some* relationship
-- to the data model; a caller with zero membership anywhere relevant is the
-- cleanest possible adversary, ruling out any question of whether Org A's
-- own membership row is doing something the WHERE clause alone wouldn't. ---
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
        'dashboard-unaffiliated@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now());

insert into organizations (id, name) values ('20000000-0000-0000-0000-0000000000e1', 'Org E - Dashboard Isolation Control (unaffiliated)');
insert into org_members (org_id, user_id, role) values ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'owner');

-- --- CONTROL CHECK, still under the fixture-loading role (RLS not yet
-- engaged -- the same role every INSERT above ran as, including the one
-- INSERT into project_permit_requirements above, a table with NO insert
-- policy at all for `authenticated`; only a role that bypasses RLS could
-- have done that, so this role's SELECTs bypass RLS too). This establishes,
-- empirically, what the bare `where org_id = p_org_id` filter alone returns
-- for Org B's org_id -- the exact claim Part 2f's RLS-blocks-it assertion
-- below depends on being non-trivial. If this returned 0, Part 2f's later
-- "0 rows" result would be meaningless (indistinguishable from the WHERE
-- clause alone matching nothing). ---
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000b');

  if v_count = 0 then
    raise exception 'FAIL (control): expected a non-zero row count for Org B with RLS not yet engaged (Org B has 1 seeded project) -- got 0. This would mean the WHERE clause alone matches nothing for Org B, making the later RLS-blocks-it assertion (Part 2f) prove nothing.';
  end if;
  raise notice 'PASS (control): with RLS not yet engaged, dashboard_project_status_counts(Org B) returns % row(s) -- confirms the bare WHERE clause DOES match Org B''s data. Part 2f''s later 0-row result under Org A''s RLS context is therefore RLS actively blocking a match that exists, not an empty match to begin with.', v_count;
end $$;

-- ============================================================
-- PART 2: assertions as Org A's owner, under RLS
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- 2a. Project status distribution
do $$
declare
  v_result jsonb;
begin
  select jsonb_object_agg(status::text, count) into v_result
  from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000a');

  -- draft:2 = seed.sql's 1 pre-existing Org A project + this file's C1.
  if v_result is distinct from '{"draft": 2, "active": 2, "completed": 1}'::jsonb then
    raise exception 'FAIL: dashboard_project_status_counts(Org A) = %, expected {draft:2,active:2,completed:1}', v_result;
  end if;
  raise notice 'PASS: dashboard_project_status_counts(Org A) matches expected distribution';
end $$;

-- 2b. Permit pipeline distribution
do $$
declare
  v_result jsonb;
begin
  select jsonb_object_agg(permit_status::text, count) into v_result
  from dashboard_permit_status_counts('20000000-0000-0000-0000-00000000000a');

  -- intake:2 = seed.sql's 1 pre-existing Org A permit_application + this file's C1.
  if v_result is distinct from '{"intake": 2, "issued": 1, "ready_to_submit": 1}'::jsonb then
    raise exception 'FAIL: dashboard_permit_status_counts(Org A) = %, expected {intake:2,ready_to_submit:1,issued:1}', v_result;
  end if;
  raise notice 'PASS: dashboard_permit_status_counts(Org A) matches expected distribution';
end $$;

-- 2c. Readiness score buckets -- also cross-checks each application's
-- bucket-driving score against compute_readiness_score() directly, proving
-- the panel's inline scalar-subquery reuse computes the same numbers the
-- real function would.
do $$
declare
  v_result jsonb;
  v_score_c1 numeric;
  v_score_c2 numeric;
  v_score_c3 numeric;
begin
  select jsonb_object_agg(bucket, count) into v_result
  from dashboard_readiness_score_buckets('20000000-0000-0000-0000-00000000000a');

  -- ready:2 = this file's C1 (100, 2/2 complete) + seed.sql's pre-existing
  -- Org A application, which has zero readiness_checklist_items rows;
  -- compute_readiness_score() defines "no required items" as score 100
  -- (20260806000025 L172-173: count(*) filter (where is_required) = 0 -> 100).
  if v_result is distinct from '{"ready": 2, "at_risk": 1, "in_progress": 1}'::jsonb then
    raise exception 'FAIL: dashboard_readiness_score_buckets(Org A) = %, expected {ready:2,in_progress:1,at_risk:1}', v_result;
  end if;

  v_score_c1 := compute_readiness_score('40000000-0000-0000-0000-0000000000c1');
  v_score_c2 := compute_readiness_score('40000000-0000-0000-0000-0000000000c2');
  v_score_c3 := compute_readiness_score('40000000-0000-0000-0000-0000000000c3');
  if v_score_c1 <> 100 or v_score_c2 <> 50 or v_score_c3 <> 0 then
    raise exception 'FAIL: compute_readiness_score() mismatch, got C1=%, C2=%, C3=% (expected 100, 50, 0)', v_score_c1, v_score_c2, v_score_c3;
  end if;
  raise notice 'PASS: dashboard_readiness_score_buckets(Org A) matches expected buckets and agrees with compute_readiness_score()';
end $$;

-- 2d. Requirements-engine summary
do $$
declare
  v_matched bigint;
  v_unresolved bigint;
  v_with_warnings bigint;
begin
  select matched, unresolved, with_warnings
  into v_matched, v_unresolved, v_with_warnings
  from dashboard_requirements_summary('20000000-0000-0000-0000-00000000000a');

  if v_matched <> 2 or v_unresolved <> 2 or v_with_warnings <> 1 then
    raise exception 'FAIL: dashboard_requirements_summary(Org A) = (matched=%, unresolved=%, with_warnings=%), expected (2, 2, 1)', v_matched, v_unresolved, v_with_warnings;
  end if;
  raise notice 'PASS: dashboard_requirements_summary(Org A) matches expected (matched=2, unresolved=2, with_warnings=1)';
end $$;

-- 2e. Document review status, archived excluded -- also proves the
-- exclusion filter is actually doing something (not vacuously passing): the
-- panel's own row total (3) is compared against the RAW row count for the
-- same application (4, all four fixture documents including the archived
-- one), read via a direct table query under the same RLS context. If
-- `archived_at is null` were ever dropped from the function body, the
-- panel's total would silently become 4 and this assertion would catch it.
do $$
declare
  v_result jsonb;
  v_panel_total bigint;
  v_raw_total bigint;
begin
  select jsonb_object_agg(status::text, count) into v_result
  from dashboard_document_review_counts('20000000-0000-0000-0000-00000000000a');

  if v_result is distinct from '{"pending": 1, "approved": 1, "rejected": 1}'::jsonb then
    raise exception 'FAIL: dashboard_document_review_counts(Org A) = %, expected {pending:1,approved:1,rejected:1} (archived excluded)', v_result;
  end if;

  select sum(count) into v_panel_total from dashboard_document_review_counts('20000000-0000-0000-0000-00000000000a');
  select count(*) into v_raw_total from application_documents where application_id = '40000000-0000-0000-0000-0000000000c1';

  if v_raw_total <> 4 then
    raise exception 'FAIL: fixture assumption broken -- expected 4 raw application_documents rows for app C1 (3 live + 1 archived), got %', v_raw_total;
  end if;
  if v_panel_total <> 3 then
    raise exception 'FAIL: dashboard_document_review_counts(Org A) panel total = %, expected 3 (4 raw rows minus 1 archived) -- the archived_at exclusion is not filtering anything', v_panel_total;
  end if;
  raise notice 'PASS: dashboard_document_review_counts(Org A) matches expected distribution; panel total (3) is strictly less than the raw row count (4), confirming the archived-row exclusion actually filters a row rather than passing vacuously';
end $$;

-- 2f. Tenant isolation, direction 1: Org A's owner passes Org B's org_id --
-- RLS (not just the function's own WHERE clause) must return zero rows,
-- proving a member of one org cannot read another org's dashboard data by
-- simply passing its id as the argument.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000b');

  if v_count <> 0 then
    raise exception 'FAIL: Org A owner querying Org B''s org_id returned % rows, expected 0 (RLS should block this regardless of the function''s own WHERE clause)', v_count;
  end if;
  raise notice 'PASS: Org A owner querying Org B''s org_id via dashboard_project_status_counts returns 0 rows (RLS-enforced, not just parameter-filtered)';
end $$;

-- ============================================================
-- PART 3: assertions as Org B's owner, under RLS
-- ============================================================

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- 3a. Org B sees its own projects (seed.sql's 1 pre-existing draft project
-- plus this file's D1, both draft -> draft:2).
do $$
declare
  v_result jsonb;
begin
  select jsonb_object_agg(status::text, count) into v_result
  from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000b');

  if v_result is distinct from '{"draft": 2}'::jsonb then
    raise exception 'FAIL: dashboard_project_status_counts(Org B) = %, expected {draft:2}', v_result;
  end if;
  raise notice 'PASS: dashboard_project_status_counts(Org B) matches expected distribution';
end $$;

-- 3b. Tenant isolation, direction 2: Org B's owner cannot see Org A's counts
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000a');

  if v_count <> 0 then
    raise exception 'FAIL: Org B owner querying Org A''s org_id returned % rows, expected 0', v_count;
  end if;
  raise notice 'PASS: Org B owner querying Org A''s org_id via dashboard_project_status_counts returns 0 rows';
end $$;

-- ============================================================
-- PART 4: assertions as Org E's owner (member of NEITHER Org A nor Org B),
-- under RLS -- the cleanest possible adversary for the RLS-vs-WHERE-clause
-- claim (see the control check in Part 1): both target orgs have real,
-- WHERE-clause-matching data, and this caller has no membership relationship
-- to either one at all.
-- ============================================================

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_count_a int;
  v_count_b int;
begin
  select count(*) into v_count_a from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000a');
  select count(*) into v_count_b from dashboard_project_status_counts('20000000-0000-0000-0000-00000000000b');

  if v_count_a <> 0 or v_count_b <> 0 then
    raise exception 'FAIL: an unaffiliated user (member of neither org) got % row(s) for Org A and % row(s) for Org B, expected 0 and 0 -- RLS must block this regardless of the WHERE clause matching real data in both orgs', v_count_a, v_count_b;
  end if;
  raise notice 'PASS: an unaffiliated user (member of neither Org A nor Org B) gets 0 rows for both, even though the WHERE clause alone would match real data in each -- this is the clean RLS-vs-WHERE-clause proof';
end $$;

reset role;

rollback;
