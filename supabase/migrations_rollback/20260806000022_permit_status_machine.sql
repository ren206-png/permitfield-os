-- Rollback for 20260806000022_permit_status_machine.sql
-- Restores permit_applications' pre-this-migration grant shape first (full
-- table-level UPDATE for authenticated, no column-level lockout --
-- 20260806000011 originally granted table-level UPDATE; this migration
-- narrowed it to just the `status` column). Then undoes every function/
-- trigger/table/column this migration added, in reverse creation order.
-- Dropping permit_status/project_id/permit_number/decision_date/
-- decision_document_id via plain ALTER TABLE ... DROP COLUMN auto-drops
-- their indexes and the two constraints that reference them (the
-- org_id_id_key unique and the project_id composite FK) without a separate
-- DROP CONSTRAINT/DROP INDEX -- Postgres always drops constraints/indexes
-- tied to a column being dropped, no CASCADE keyword needed for that.
-- application_status_history is dropped before permit_applications' columns
-- since it holds the composite FK referencing permit_applications
-- (org_id, id).

revoke update (status) on permit_applications from authenticated;
grant update on permit_applications to authenticated;

drop trigger if exists permit_applications_seed_status_history on permit_applications;
drop function if exists seed_permit_status_history();

revoke execute on function transition_permit_status(uuid, permit_status_enum, text, uuid) from authenticated;
drop function if exists transition_permit_status(uuid, permit_status_enum, text, uuid);

revoke execute on function permit_status_tier(permit_status_enum) from authenticated, service_role;
drop function if exists permit_status_tier(permit_status_enum);

revoke select on permit_status_transitions from authenticated, service_role;
drop policy if exists permit_status_transitions_select on permit_status_transitions;
drop table if exists permit_status_transitions;

drop trigger if exists application_status_history_append_only on application_status_history;
revoke select on application_status_history from authenticated;
drop policy if exists application_status_history_select on application_status_history;
drop table if exists application_status_history;

alter table permit_applications drop column if exists decision_document_id;
alter table permit_applications drop column if exists decision_date;
alter table permit_applications drop column if exists permit_number;
alter table permit_applications drop column if exists project_id;
alter table permit_applications drop column if exists permit_status;

alter table permit_applications drop constraint if exists permit_applications_org_id_id_key;

drop type if exists permit_status_enum;
