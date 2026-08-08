-- BLOCKED -- DO NOT MOVE THIS FILE INTO supabase/migrations/ UNTIL THE
-- APPLICATION LAYER IS FIXED.
--
-- Lifecycle & Compliance Expansion, Phase 1.3 follow-up, part 2 of 2.
-- Companion to 20260806000023_backfill_permit_application_project_id.sql
-- (which IS in supabase/migrations/ and runs today). 20260806000023 backfills every
-- *existing* orphaned permit_applications row so project_id is never null
-- for pre-existing data. This migration (23b) is the second half: it makes
-- project_id NOT NULL going forward.
--
-- WHY THIS IS NOT WIRED IN: Gate 1.3 review (2026-08-07) found that
-- app/(app)/applications/new/actions.ts:78-90 (createApplicationAction --
-- the only INSERT into permit_applications anywhere in application code,
-- confirmed by exhaustive grep across app/, lib/inngest/functions/,
-- supabase/seed.sql, and supabase/tests/) creates a permit_applications row
-- with NO project_id, and its form
-- (app/(app)/applications/new/new-application-form.tsx) has no project
-- selector, lookup, or creation step. If this migration is applied while
-- that action is unchanged, every new "Create permit application" submit
-- fails with a NOT NULL constraint violation.
--
-- This migration intentionally does NOT backfill anything -- if it is ever
-- run and finds a null project_id, that means either (a) it was applied
-- before createApplicationAction was fixed (a process error -- go fix the
-- app first), or (b) some new, unaudited insert path was added without
-- setting project_id (a real bug -- go find it). Both cases need a human,
-- not a silent backfill.
--
-- SHIPS: in the future gate that makes project selection/creation mandatory
-- ahead of, or as part of, permit application creation (i.e. once
-- createApplicationAction is updated to require/derive a project_id). At
-- that point: move this file into supabase/migrations/ with a fresh
-- timestamp prefix so it sorts after every migration that has landed by
-- then, update this header to remove the BLOCKED notice, and delete this
-- copy from migrations_blocked/.

do $$
declare
  orphan_count integer;
begin
  select count(*) into orphan_count from permit_applications where project_id is null;

  if orphan_count > 0 then
    raise exception
      'permit_application_project_id_not_null: % row(s) still have project_id is null. Refusing to backfill here -- resolve manually (this migration is intentionally backfill-free; see 20260806000023 for the one-time backfill of pre-existing orphans). A human needs to look at this before this migration can proceed.',
      orphan_count;
  end if;
end $$;

alter table permit_applications alter column project_id set not null;
