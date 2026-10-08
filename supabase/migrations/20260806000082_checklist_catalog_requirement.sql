-- Requirements review: link each readiness checklist item to the catalog
-- requirement (permit_requirements, migration 080) it was copied from, so the
-- readiness panel can show whether that requirement has been verified by a
-- named reviewer (admin Requirements review page) instead of one blanket
-- "not yet reviewed" note.
--
-- Not readiness_checklist_items.source_requirement_id: that column already
-- points at project_permit_requirements (per-project evaluation rows,
-- migration 026), which applications created from /applications/new don't
-- have. This is the catalog row itself. Nullable and `on delete set null`:
-- custom items have none, and a catalog row is retired (archived_at), never
-- deleted, in normal use.

alter table readiness_checklist_items
  add column catalog_requirement_id uuid references permit_requirements(id) on delete set null;

create index readiness_checklist_items_catalog_requirement_id_idx
  on readiness_checklist_items (catalog_requirement_id);

-- Backfill items added before this column existed: same permit type, same
-- title, same source URL as the catalog row they were copied from.
update readiness_checklist_items rci
set catalog_requirement_id = pr.id
from permit_applications pa
join permit_requirements pr on pr.permit_type_id = pa.permit_type_id
left join jurisdiction_sources js on js.id = pr.source_id
where rci.application_id = pa.id
  and rci.org_id = pa.org_id
  and rci.catalog_requirement_id is null
  and rci.title = pr.title
  and rci.source_requirement is not distinct from js.url;
