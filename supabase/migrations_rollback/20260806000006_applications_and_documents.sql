-- Rollback for 20260806000006_applications_and_documents.sql
-- application_documents is dropped before permit_applications (FK child
-- before parent). All three indexes are dropped implicitly with their
-- owning table. Enum types (application_status, doc_kind) are dropped last,
-- after both tables that use them are gone.

drop policy if exists application_documents_delete on application_documents;
drop policy if exists application_documents_insert on application_documents;
drop policy if exists application_documents_select on application_documents;
drop policy if exists permit_applications_delete on permit_applications;
drop policy if exists permit_applications_update on permit_applications;
drop policy if exists permit_applications_insert on permit_applications;
drop policy if exists permit_applications_select on permit_applications;

drop table if exists application_documents;
drop table if exists permit_applications;

drop type if exists doc_kind;
drop type if exists application_status;
