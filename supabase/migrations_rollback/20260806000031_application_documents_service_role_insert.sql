-- Rollback for 20260806000031_application_documents_service_role_insert.sql
-- Single additive GRANT; revoke it. Mirrors this directory's convention for
-- single-grant migrations (e.g. 20260806000015's rollback). Does not touch
-- service_role's pre-existing select/update grant on this table, or any
-- other role's privileges -- same non-widening scope the forward migration
-- itself documents.

revoke insert on application_documents from service_role;
