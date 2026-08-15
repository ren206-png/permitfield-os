-- Rollback for 20260806000028_dashboard_queries.sql
-- Five independent, non-SECURITY-DEFINER `language sql stable` functions,
-- each with its own grant and no table/type/policy of its own. Dropped in
-- reverse creation order; each drop is independent of the others.

revoke execute on function dashboard_document_review_counts(uuid) from authenticated, service_role;
drop function if exists dashboard_document_review_counts(uuid);

revoke execute on function dashboard_requirements_summary(uuid) from authenticated, service_role;
drop function if exists dashboard_requirements_summary(uuid);

revoke execute on function dashboard_readiness_score_buckets(uuid) from authenticated, service_role;
drop function if exists dashboard_readiness_score_buckets(uuid);

revoke execute on function dashboard_permit_status_counts(uuid) from authenticated, service_role;
drop function if exists dashboard_permit_status_counts(uuid);

revoke execute on function dashboard_project_status_counts(uuid) from authenticated, service_role;
drop function if exists dashboard_project_status_counts(uuid);
