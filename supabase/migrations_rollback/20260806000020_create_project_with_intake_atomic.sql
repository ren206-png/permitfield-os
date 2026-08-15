-- Rollback for 20260806000020_create_project_with_intake_atomic.sql

revoke execute on function create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text) from authenticated;

drop function if exists create_project_with_intake(uuid, text, text, uuid, text, text, project_status, text, text, text, text, text, text, text, text);
