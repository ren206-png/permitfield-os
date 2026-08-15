-- Rollback for 20260806000007_extractions.sql
-- The append-only trigger must be dropped before the forbid_update_delete()
-- function it executes (a trigger depends on its function). Note
-- forbid_update_delete() is reused by migration 20260806000009's
-- audits_append_only trigger -- dropping it here is only safe when this
-- rollback is applied with the schema pinned to this migration's version
-- (no later migration present), which is the documented precondition for
-- every file in this directory.

drop trigger if exists extractions_append_only on extractions;
drop function if exists forbid_update_delete();

drop policy if exists extractions_select on extractions;

drop table if exists extractions;
