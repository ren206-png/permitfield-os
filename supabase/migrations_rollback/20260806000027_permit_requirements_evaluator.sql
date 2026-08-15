-- Rollback for 20260806000027_permit_requirements_evaluator.sql
-- Functions dropped in reverse creation order (review_project_permit_requirement
-- -> evaluate_project_permit_requirements -> match_permit_requirements), then
-- the composite return type match_permit_requirements() depended on, then the
-- three additive columns this migration added -- dropping
-- project_permit_requirements.evaluation_run_id auto-drops its two indexes,
-- dropping properties.jurisdiction_id auto-drops its index, and dropping
-- projects.estimated_construction_value_cents auto-drops its CHECK
-- constraint, same "column drop cascades to its own indexes/constraints"
-- reasoning used throughout this rollback set.

revoke execute on function review_project_permit_requirement(uuid) from authenticated, service_role;
drop function if exists review_project_permit_requirement(uuid);

revoke execute on function evaluate_project_permit_requirements(uuid) from authenticated, service_role;
drop function if exists evaluate_project_permit_requirements(uuid);

revoke execute on function match_permit_requirements(uuid, text, text, text, text[], bigint) from authenticated, service_role;
drop function if exists match_permit_requirements(uuid, text, text, text, text[], bigint);

drop type if exists permit_requirement_match_result;

alter table project_permit_requirements drop column if exists evaluation_run_id;

alter table properties drop column if exists jurisdiction_id;

alter table projects drop column if exists estimated_construction_value_cents;
