-- Rollback for 20260806000012_add_extracted_status.sql
-- Postgres has no `ALTER TYPE ... DROP VALUE`; removing an enum value
-- requires recreating the type. This is only safe if no row currently holds
-- the 'extracted' value -- true in the --no-seed rollback-test loop this
-- directory is verified against (fresh schema, zero data), and enforced
-- below with an explicit guard so a populated database fails loud instead
-- of this rollback silently orphaning a real 'extracted' row. If the guard
-- fires, those rows must be moved off 'extracted' (e.g. back to
-- 'extracting' or forward to 'auditing') before this rollback can run.

do $$
begin
  if exists (select 1 from permit_applications where status = 'extracted') then
    raise exception 'cannot roll back 20260806000012: % row(s) still have status = ''extracted''; migrate those rows off this value first',
      (select count(*) from permit_applications where status = 'extracted');
  end if;
end $$;

alter type application_status rename to application_status_old;

create type application_status as enum (
  'draft',
  'uploading',
  'extracting',
  'extraction_failed',
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
