-- Rollback for 20260806000032_bridge_read_grants.sql
-- Three additive SELECT grants; revoke them in reverse order. Does not
-- touch authenticated's own select grant on any of the three tables, or
-- service_role's pre-existing grants on any other table -- same
-- non-widening scope the forward migration itself documents.

revoke select on readiness_checklist_items from service_role;
revoke select on application_status_history from service_role;
revoke select on organizations from service_role;
