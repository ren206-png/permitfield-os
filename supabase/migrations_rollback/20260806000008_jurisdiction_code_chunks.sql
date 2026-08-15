-- Rollback for 20260806000008_jurisdiction_code_chunks.sql
-- All three indexes (jurisdiction_id btree, content_tsv gin, embedding
-- ivfflat) are dropped implicitly with the table, along with the generated
-- content_tsv column. license_status enum is dropped last.

drop policy if exists jurisdiction_code_chunks_select on jurisdiction_code_chunks;

drop table if exists jurisdiction_code_chunks;

drop type if exists license_status;
