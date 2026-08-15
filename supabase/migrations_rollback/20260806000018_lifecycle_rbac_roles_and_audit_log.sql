-- Rollback for 20260806000018_lifecycle_rbac_roles_and_audit_log.sql
-- audit_logs and its supporting function/trigger/policies are dropped
-- outright (this migration created them fresh). org_role's 8 new values
-- cannot be removed with ALTER TYPE (no DROP VALUE in Postgres), so the type
-- is recreated with just the original ('owner', 'member') pair, same pattern
-- as 20260806000012/20260806000016's rollback -- guarded to fail loud rather
-- than silently orphan a real role assignment if any org_members row already
-- uses one of the 8 new values (expected to be none in the --no-seed
-- rollback-test loop this directory is verified against).

revoke select, insert on audit_logs from service_role;
revoke select, insert, update, delete on audit_logs from authenticated;

drop trigger if exists audit_logs_append_only on audit_logs;

drop policy if exists audit_logs_insert on audit_logs;
drop policy if exists audit_logs_select on audit_logs;

drop function if exists can_read_audit_logs(uuid);

drop table if exists audit_logs;

do $$
begin
  if exists (
    select 1 from org_members
    where role in (
      'platform_admin', 'org_owner', 'permit_manager', 'permit_coordinator',
      'document_reviewer', 'applicant_contractor', 'client_user', 'auditor_readonly'
    )
  ) then
    raise exception 'cannot roll back 20260806000018: org_members row(s) still use one of the 8 roles this migration added; reassign those rows first';
  end if;
end $$;

alter type org_role rename to org_role_old;

create type org_role as enum ('owner', 'member');

alter table org_members
  alter column role drop default;

alter table org_members
  alter column role type org_role
  using role::text::org_role;

alter table org_members
  alter column role set default 'member';

drop type org_role_old;
