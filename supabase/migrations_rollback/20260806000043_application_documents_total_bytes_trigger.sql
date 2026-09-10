-- Rollback for 20260806000043_application_documents_total_bytes_trigger.sql
-- Drops the trigger and its function, restoring application_documents
-- inserts to being governed only by the pre-existing per-file byte_size
-- CHECK constraint (migration 20260806000006) and the application-layer
-- total-bytes check in app/api/documents/route.ts -- i.e. back to the
-- check-then-act race this migration closed.
drop trigger if exists application_documents_total_bytes_check on application_documents;
drop function if exists enforce_application_documents_total_bytes();
