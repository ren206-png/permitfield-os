-- Rollback for 20260806000038_application_document_chunks.sql
-- Drops the table (and its retrieval RPC) outright -- this migration
-- created both fresh, with zero ingestion pipeline and zero call sites
-- (its own header), so there is no live data or in-flight query either drop
-- could disrupt.

revoke execute on function search_application_document_chunks(uuid, uuid, text, vector, int) from service_role;
revoke execute on function search_application_document_chunks(uuid, uuid, text, vector, int) from authenticated;
drop function if exists search_application_document_chunks(uuid, uuid, text, vector, int);

revoke select, insert on application_document_chunks from service_role;
revoke select, insert, update, delete on application_document_chunks from authenticated;

drop trigger if exists application_document_chunks_append_only on application_document_chunks;

drop policy if exists application_document_chunks_select on application_document_chunks;

drop table if exists application_document_chunks;
