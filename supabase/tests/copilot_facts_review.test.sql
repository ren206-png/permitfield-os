-- Gate 6, sub-phase 6.4: proves 20260806000096_copilot_task_kind.sql:
--   1. 'copilot' is an ai_task_kind value.
--   2. A proposed fact can be decided once: the first confirm succeeds (as
--      the org member, through RLS), a second decision on the same proposal
--      -- confirm or reject, e.g. from a second tab -- fails with
--      unique_violation, and the ledger keeps exactly one decision.
--   3. A correction can supersede a confirmed fact (once), so normal
--      corrections still work.
--
-- Expected failures are caught by SQLSTATE, never `when others`.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

do $$
begin
  if not ('copilot' = any (enum_range(null::ai_task_kind)::text[])) then
    raise exception 'FAIL: copilot is not an ai_task_kind';
  end if;
  raise notice 'PASS: copilot is an ai_task_kind value';
end $$;

-- Seed fixtures: org A owner and org A's project (supabase/seed.sql).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into project_facts (id, org_id, project_id, fact_key, value, unit, provenance, state, created_by)
values ('c8000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
        'project.floor_area', '118', 'm2', 'document_extraction', 'proposed', auth.uid());

do $$
begin
  insert into project_facts (id, org_id, project_id, fact_key, value, unit, provenance, state, reviewed_by, reviewed_at, supersedes_fact_id, created_by)
  values ('c8000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
          'project.floor_area', '118', 'm2', 'document_extraction', 'confirmed', auth.uid(), now(),
          'c8000000-0000-0000-0000-000000000001', auth.uid());
  raise notice 'PASS: control: the first decision on a proposal succeeds';
end $$;

do $$
begin
  insert into project_facts (org_id, project_id, fact_key, value, unit, provenance, state, reviewed_by, reviewed_at, supersedes_fact_id, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
          'project.floor_area', '118', 'm2', 'document_extraction', 'rejected', auth.uid(), now(),
          'c8000000-0000-0000-0000-000000000001', auth.uid());
  raise exception 'FAIL: a proposal was decided twice';
exception when unique_violation then
  raise notice 'PASS: a second decision on the same proposal is refused (unique_violation)';
end $$;

do $$
declare n int;
begin
  select count(*) into n from project_facts where supersedes_fact_id = 'c8000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: expected exactly one decision, found %', n; end if;
  raise notice 'PASS: the ledger holds exactly one decision for the proposal';
end $$;

do $$
begin
  insert into project_facts (org_id, project_id, fact_key, value, unit, provenance, state, reviewed_by, reviewed_at, supersedes_fact_id, created_by)
  values ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
          'project.floor_area', '121', 'm2', 'user_entered', 'confirmed', auth.uid(), now(),
          'c8000000-0000-0000-0000-000000000002', auth.uid());
  raise notice 'PASS: a correction can supersede the confirmed fact';
end $$;

rollback;
