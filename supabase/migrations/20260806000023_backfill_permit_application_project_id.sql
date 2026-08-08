-- Lifecycle & Compliance Expansion, Phase 1.3 follow-up: backfills
-- `permit_applications.project_id` for every row 20260806000022 left null,
-- then sets the column NOT NULL. Explicitly dated/sequenced as its own
-- migration, per the user's own decision during Gate 1.3 planning: ship
-- `project_id` nullable in the main migration (so existing rows aren't
-- broken the instant the column exists), then close the gap here.
--
-- SAFETY (both conditions below are the user's explicit requirements, not
-- this migration's own invention):
--   1. Every synthesized `projects` row is permanently marked
--      `source = 'backfill'` -- distinguishable from a real, intake-created
--      project forever, not just at migration time.
--   2. A hardcoded orphan-count assertion fails the whole migration LOUDLY
--      if there are more than 10 orphaned `permit_applications` rows,
--      instead of silently synthesizing placeholder projects at scale.
--      PHASE_0_FINDINGS.md SS L.4 confirmed (via supabase/seed.sql) that
--      only 2 dev-fixture rows exist today with no project link -- 10 is
--      comfortably above that known-good count while still catching "this
--      migration accidentally ran against a real database" before it does
--      real damage. If this ever fires, the fix is to resolve project_id
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

do $$
declare
  orphan_count integer;
  r record;
  new_project_id uuid;
begin
  select count(*) into orphan_count from permit_applications where project_id is null;

  if orphan_count > 10 then
    raise exception
      'permit_applications backfill safety valve: % orphaned rows found (project_id is null), expected at most 10 (seed-fixture scale per PHASE_0_FINDINGS.md SS L.4). Refusing to synthesize placeholder projects at this scale -- resolve project_id linkage manually, or re-run this migration only after deliberately raising this threshold with its own documented justification.',
      orphan_count;
  end if;

  -- One minimal placeholder project per orphaned application. `title` is
  -- the only NOT NULL column on `projects` besides org_id/status
  -- (20260806000019 L150), so this is the smallest legal row --
  -- deliberately not populating client_id/property_id/contractor_id/
  -- taxonomy_id (all nullable): those describe real intake data this
  -- migration has no source for, and guessing would misrepresent a
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
end $$;

alter table permit_applications alter column project_id set not null;
