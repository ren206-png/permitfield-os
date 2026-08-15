-- Rollback for 20260806000024_lifecycle_documents_revisions.sql
-- Restores the application_documents_delete policy and DELETE grant this
-- migration removed (originally from 20260806000006 and 20260806000011
-- respectively) before undoing everything else in reverse creation order.
-- Dropping any of the 7 columns added to application_documents auto-drops
-- the 3 CHECK constraints that reference it -- no separate DROP CONSTRAINT
-- needed, same reasoning as 20260806000022's rollback.

create policy application_documents_delete on application_documents
  for delete to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = application_documents.application_id
        and is_org_member(pa.org_id)
    )
  );

grant delete on application_documents to authenticated;

revoke select on document_revisions from authenticated;

revoke execute on function archive_application_document(uuid) from authenticated;
drop function if exists archive_application_document(uuid);

revoke execute on function replace_application_document(uuid, text, text, text, bigint, char(64), bytea) from authenticated;
drop function if exists replace_application_document(uuid, text, text, text, bigint, char(64), bytea);

revoke execute on function validate_document_magic_bytes(text, bytea) from authenticated, service_role;
drop function if exists validate_document_magic_bytes(text, bytea);

drop trigger if exists application_documents_seed_revision on application_documents;
drop function if exists seed_document_revision();

drop trigger if exists document_revisions_append_only on document_revisions;
drop policy if exists document_revisions_select on document_revisions;
drop table if exists document_revisions;

alter table application_documents drop column if exists archived_by;
alter table application_documents drop column if exists archived_at;
alter table application_documents drop column if exists rejection_reason;
alter table application_documents drop column if exists reviewed_at;
alter table application_documents drop column if exists reviewed_by;
alter table application_documents drop column if exists uploaded_by;
alter table application_documents drop column if exists status;

drop type if exists document_review_status;
