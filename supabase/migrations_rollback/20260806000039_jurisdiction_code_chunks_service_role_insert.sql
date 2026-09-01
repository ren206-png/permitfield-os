-- Rollback for 20260806000039_jurisdiction_code_chunks_service_role_insert.sql
-- Revokes the INSERT grant this migration added. No ingestion pipeline
-- exists yet (this migration's own header), so there is no live writer
-- this revoke could break -- only the test fixture that exposed the gap,
-- which is exactly what should start failing again if this is rolled back.

revoke insert on jurisdiction_code_chunks from service_role;
