-- Rollback for 20260806000017_filing_form_templates_and_generated_documents.sql
-- Reverse order: bucket row, then service_role grants, then authenticated
-- grants, then the append-only trigger (depends on forbid_update_delete,
-- owned by migration 20260806000007 and not touched here), then the policy,
-- then the table, then the two ALTER TABLE ADD COLUMNs on the pre-existing
-- permit_type_filings/permit_form_fields tables -- dropping a column also
-- drops its index, FK, and NOT NULL constraint, so no separate DROP INDEX
-- is needed.
--
-- storage.buckets carries a Supabase-platform protect_buckets_delete trigger
-- (storage.protect_delete()) that raises unless the session-local GUC
-- storage.allow_delete_query is 'true' -- same fix as 20260806000013's
-- rollback, confirmed empirically by this rollback's own test run. `set
-- local` + an explicit transaction block scopes the override to just this
-- delete.

begin;
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'permitfield-form-templates';
commit;

revoke select, insert on generated_documents from service_role;
revoke select on contractors from service_role;
revoke select on permit_form_fields from service_role;
revoke select on permit_type_filings from service_role;

revoke select, insert, update, delete on generated_documents from authenticated;

drop trigger if exists generated_documents_append_only on generated_documents;

drop policy if exists generated_documents_select on generated_documents;

drop table if exists generated_documents;

alter table permit_form_fields drop column if exists permit_type_filing_id;

alter table permit_type_filings drop column if exists form_template_path;
