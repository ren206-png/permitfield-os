-- Rollback for 20260806000033_revoke_service_role_truncate_append_only.sql
-- Re-grants TRUNCATE to service_role on exactly the seven tables this
-- migration revoked it from -- restores the platform-default privilege set
-- this migration deliberately narrowed, matching the forward file's own
-- scoped list rather than a blanket restore. UPDATE/DELETE were never
-- touched by the forward migration (the row-level triggers already reject
-- both for service_role), so there is nothing to restore for those here.

grant truncate on extractions to service_role;
grant truncate on audits to service_role;
grant truncate on audit_findings to service_role;
grant truncate on generated_documents to service_role;
grant truncate on audit_logs to service_role;
grant truncate on application_status_history to service_role;
grant truncate on document_revisions to service_role;
