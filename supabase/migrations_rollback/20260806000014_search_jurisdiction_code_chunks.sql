-- Rollback for 20260806000014_search_jurisdiction_code_chunks.sql
-- Revoke both explicit grants before dropping the function (the grants are
-- privileges on the function object; dropping the function first would
-- revoke them implicitly anyway, but the explicit order mirrors this
-- directory's convention elsewhere and makes the reversal self-documenting).

revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) from service_role;
revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) from authenticated;

drop function if exists search_jurisdiction_code_chunks(uuid, text, vector, int);
