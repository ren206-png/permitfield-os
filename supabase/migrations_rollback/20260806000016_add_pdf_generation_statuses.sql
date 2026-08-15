-- Rollback for 20260806000016_add_pdf_generation_statuses.sql
-- Postgres has no `ALTER TYPE ... DROP VALUE`; removing the three enum
-- values this migration added requires recreating the type, same pattern as
-- 20260806000012's rollback. Only safe if no row currently holds one of the
-- three -- true in the --no-seed rollback-test loop this directory is
-- verified against, guarded explicitly so a populated database fails loud
-- instead of silently orphaning a real row. The recreated type's value list
-- is the exact post-20260806000012 / pre-this-migration set (draft through
-- submitted, plus 'extracted' -- NOT the original migration 0006 set, since
-- 'extracted' predates this migration and must be preserved).

do $$
begin
  if exists (
    select 1 from permit_applications
    where status in ('generating_documents', 'document_generation_failed', 'documents_generated')
  ) then
    raise exception 'cannot roll back 20260806000016: row(s) still hold one of the three PDF-generation statuses; migrate those rows off those values first';
  end if;
end $$;

alter type application_status rename to application_status_old;

create type application_status as enum (
  'draft',
  'uploading',
  'extracting',
  'extraction_failed',
  'extracted',
  'auditing',
  'audit_failed',
  'ready_for_review',
  'reviewed',
  'submitted'
);

alter table permit_applications
  alter column status drop default;

alter table permit_applications
  alter column status type application_status
  using status::text::application_status;

alter table permit_applications
  alter column status set default 'draft';

drop type application_status_old;
