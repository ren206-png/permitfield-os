-- Lifecycle & Compliance Expansion, Phase 1.3 follow-up: backfills
-- `permit_applications.project_id` for every row 20260806000022 left null.
-- Explicitly dated/sequenced as its own migration, per the user's own
-- decision during Gate 1.3 planning: ship `project_id` nullable in the main
-- migration (so existing rows aren't broken the instant the column exists),
-- then close the gap here.
--
-- THIS MIGRATION DELIBERATELY DOES NOT SET project_id NOT NULL. It was
-- split out of what was originally a single 20260806000023 migration after
-- Gate 1.3 review found a live app-code path -- createApplicationAction,
-- app/(app)/applications/new/actions.ts:78-90, the only INSERT into
-- permit_applications in application code -- that creates a row with no
-- project_id and has no UI/logic to supply one. Setting NOT NULL here would
-- break that path immediately on `supabase db reset`. The NOT NULL half is
-- 20260806000023b (supabase/migrations_blocked/), which is WRITTEN but
-- deliberately NOT placed in supabase/migrations/ and NOT run -- it ships
-- once a future gate makes project selection/creation mandatory ahead of
-- permit application creation. This migration backfills existing orphans so
-- no *pre-existing* row is missing a project_id, but new orphans from the
-- still-open app-code path remain possible until 20260806000023b ships --
-- see docs/STATUS_TRANSITIONS.md and the Gate 1.3 report for the tracked
-- follow-up.
--
-- WHAT COUNTS AS "PRE-EXISTING" (Gate 1.3 review, round 2 -- corrected after
-- empirical verification found the original claim below was wrong): the
-- backfill loop below (wrapped in backfill_orphaned_application_projects())
-- runs once, at migration-apply time, against whatever rows already exist
-- in `permit_applications` at that moment. In production that's every real
-- orphaned row that predates this migration -- exactly what it's for. Under
-- `supabase db reset`, though, migrations 1-23 all apply BEFORE
-- supabase/seed.sql runs, so any row seed.sql inserts is invisible to this
-- migration's scan; a seed-fixture "orphan" would never actually get
-- backfilled by a fresh reset, it would just stay null forever. An earlier
-- version of this comment claimed this migration "backfills the 2 seed
-- fixtures" -- that was asserted by reasoning, not verified, and was false.
-- It's now moot: supabase/seed.sql was corrected (Gate 1.3 review, round 2)
-- to give both fixture rows a real, ordinary project_id directly, so `db
-- reset` now produces zero orphans on its own. This migration's loop is
-- exercised by supabase/tests/permit_status_machine.test.sql instead, with
-- self-contained fixtures inside a rolled-back transaction.
--
-- NOTE ON NAMING: originally planned as "20260806000023a" to pair visually
-- with the blocked "20260806000023b" companion, but the Supabase CLI's
-- migration filename pattern requires the prefix to be purely numeric
-- (confirmed empirically -- `supabase db reset` silently skips any file
-- whose prefix isn't `<digits>_name.sql`, logging "file name must match
-- pattern" rather than erroring loudly). Kept the original numeric
-- 20260806000023 filename; "23a"/"23b" survive only as informal labels in
-- prose comments, not as literal filenames.
--
-- SAFETY (both conditions below are the user's explicit requirements, not
-- this migration's own invention):
--   1. Every synthesized `projects` row is permanently marked
--      `source = 'backfill'` -- distinguishable from a real, intake-created
--      project forever, not just at migration time.
--   2. A hardcoded orphan-count assertion fails the whole operation LOUDLY
--      if there are more than 10 orphaned `permit_applications` rows,
--      instead of silently synthesizing placeholder projects at scale.
--      PHASE_0_FINDINGS.md SS L.4 confirmed (via supabase/seed.sql, before
--      it was corrected to stop producing orphans -- see above) that only
--      2 dev-fixture rows existed with no project link -- 10 is comfortably
--      above that known-good count while still catching "this ran against
--      a real database with real unresolved orphans" before it does real
--      damage. If this ever fires, the fix is to resolve project_id
--      linkage manually (or deliberately raise the threshold with its own
--      reasoning), not to silently raise it and re-run.
alter table projects add column source text;
-- Nullable, no default: every existing and future real project row is
-- completely unaffected (stays null forever unless something explicitly
-- sets it) -- only the placeholder rows this migration inserts below ever
-- get 'backfill'. Purely additive, same "new column with no behavior change
-- until something reads it" pattern as every other infrastructure-ahead-of-
-- its-consumer column in this repo (e.g. permit_number/decision_date/
-- decision_document_id added by 20260806000022 itself).

-- Extracted into a function (Gate 1.3 review, round 2) rather than an
-- inline `do $$ ... $$` block: the safety-valve/backfill logic is otherwise
-- untestable outside migration-apply time. `supabase db reset` runs this
-- migration long before supabase/seed.sql or any SQL test file gets a
-- chance to create orphaned rows, so an inline block could never be
-- exercised by a test with fixtures of its own -- see
-- supabase/tests/permit_status_machine.test.sql section 14, which calls
-- this function directly against self-contained, rolled-back fixtures to
-- cover both the normal-backfill path and the >10-orphans safety valve.
-- Behavior is identical to the original inline block; only the packaging
-- changed.
create or replace function backfill_orphaned_application_projects()
returns integer
language plpgsql
as $$
declare
  orphan_count integer;
  r record;
  new_project_id uuid;
begin
  select count(*) into orphan_count from permit_applications where project_id is null;

  if orphan_count > 10 then
    raise exception
      'permit_applications backfill safety valve: % orphaned rows found (project_id is null), expected at most 10 (seed-fixture scale per PHASE_0_FINDINGS.md SS L.4). Refusing to synthesize placeholder projects at this scale -- resolve project_id linkage manually, or re-run this function only after deliberately raising this threshold with its own documented justification.',
      orphan_count;
  end if;

  -- One minimal placeholder project per orphaned application. `title` is
  -- the only NOT NULL column on `projects` besides org_id/status
  -- (20260806000019 L150), so this is the smallest legal row --
  -- deliberately not populating client_id/property_id/contractor_id/
  -- taxonomy_id (all nullable): those describe real intake data this
  -- function has no source for, and guessing would misrepresent a
  -- placeholder as a real intake record.
  for r in select id, org_id, project_title from permit_applications where project_id is null loop
    insert into projects (org_id, title, status, source)
    values (
      r.org_id,
      coalesce('Backfilled: ' || r.project_title, 'Backfilled placeholder project'),
      'draft',
      'backfill'
    )
    returning id into new_project_id;

    update permit_applications set project_id = new_project_id where id = r.id;
  end loop;

  return orphan_count;
end;
$$;

comment on function backfill_orphaned_application_projects() is
  'One-time-per-call backfill: synthesizes a minimal placeholder projects row (source = ''backfill'') for every permit_applications row with a null project_id, up to a hardcoded safety valve of 10 orphans (raises if exceeded). Called by migration 20260806000023 at migration-apply time; also called directly by supabase/tests/permit_status_machine.test.sql to exercise both the backfill path and the safety valve, since supabase/seed.sql now inserts no orphans for it to catch under supabase db reset.';

select backfill_orphaned_application_projects();

-- No `alter table ... alter column project_id set not null` here on purpose
-- -- see the file header. That constraint lives in the unrun
-- 20260806000023b, blocked on the application-layer fix to
-- createApplicationAction.
