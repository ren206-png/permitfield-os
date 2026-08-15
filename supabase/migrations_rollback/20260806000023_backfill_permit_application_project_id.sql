-- Rollback for 20260806000023_backfill_permit_application_project_id.sql
-- Reverses exactly the placeholder projects this migration's
-- backfill_orphaned_application_projects() synthesized -- identifiable by
-- source = 'backfill', the column this same migration added for exactly
-- this purpose. Any permit_applications row pointing at one of them is set
-- back to project_id = null before those placeholder projects are deleted.
-- A real project_id -- whether it predated this migration or was set by
-- ordinary application code afterward -- is untouched, since it never has
-- source = 'backfill'. This does NOT reconstruct which specific rows were
-- null before this migration ran beyond what the source marker already
-- proves; that is exactly the set this migration itself modified, so it is
-- also exactly the set this rollback needs to undo.

update permit_applications pa
set project_id = null
from projects p
where pa.project_id = p.id
  and p.source = 'backfill';

delete from projects where source = 'backfill';

drop function if exists backfill_orphaned_application_projects();

alter table projects drop column if exists source;
