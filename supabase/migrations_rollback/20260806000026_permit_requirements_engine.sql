-- Rollback for 20260806000026_permit_requirements_engine.sql
-- readiness_checklist_items.source_requirement_id (a P.3 retrofit onto a
-- table from 20260806000025) is dropped first since it FKs to
-- project_permit_requirements, which must itself be dropped before the two
-- tables it references (permit_requirements, jurisdiction_permit_rules).
-- jurisdiction_permit_rules is dropped before permit_requirements since it
-- FKs to it. project_taxonomy_selections has no incoming FK from anything
-- else in this migration and is dropped last among the tables, followed by
-- the additive unique constraint this migration added to the pre-existing
-- taxonomies table.

alter table readiness_checklist_items drop column if exists source_requirement_id;

revoke select on project_permit_requirements from authenticated;
revoke select, insert, update on project_permit_requirements from service_role;
drop policy if exists project_permit_requirements_select on project_permit_requirements;
drop table if exists project_permit_requirements;

revoke select, insert, update on jurisdiction_permit_rules from authenticated;
revoke select, insert, update on jurisdiction_permit_rules from service_role;
drop policy if exists jurisdiction_permit_rules_update on jurisdiction_permit_rules;
drop policy if exists jurisdiction_permit_rules_insert on jurisdiction_permit_rules;
drop policy if exists jurisdiction_permit_rules_select on jurisdiction_permit_rules;
drop table if exists jurisdiction_permit_rules;

revoke select, insert, update on permit_requirements from authenticated;
revoke select, insert, update on permit_requirements from service_role;
drop policy if exists permit_requirements_update on permit_requirements;
drop policy if exists permit_requirements_insert on permit_requirements;
drop policy if exists permit_requirements_select on permit_requirements;
drop table if exists permit_requirements;

drop type if exists permit_requirement_verification_status;

revoke select, insert, delete on project_taxonomy_selections from authenticated;
revoke select, insert, update, delete on project_taxonomy_selections from service_role;
drop policy if exists project_taxonomy_selections_delete on project_taxonomy_selections;
drop policy if exists project_taxonomy_selections_insert on project_taxonomy_selections;
drop policy if exists project_taxonomy_selections_select on project_taxonomy_selections;
drop table if exists project_taxonomy_selections;

alter table taxonomies drop constraint if exists taxonomies_org_id_id_kind_key;
