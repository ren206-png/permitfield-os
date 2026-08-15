-- Rollback for 20260806000009_audits_and_findings.sql
-- Triggers before the functions they execute; audit_findings (the FK
-- child, and the table every trigger/policy here that isn't audits_select
-- targets) is dropped before audits. forbid_update_delete() (used by the
-- audits_append_only trigger) is owned by migration 20260806000007 and is
-- deliberately NOT dropped here.

drop trigger if exists audit_findings_no_delete on audit_findings;
drop function if exists forbid_delete();

drop trigger if exists audit_findings_restrict_update_trigger on audit_findings;
drop function if exists audit_findings_restrict_update();

drop trigger if exists audits_append_only on audits;

drop policy if exists audit_findings_review_update on audit_findings;
drop policy if exists audit_findings_select on audit_findings;
drop policy if exists audits_select on audits;

drop table if exists audit_findings;
drop table if exists audits;

drop type if exists finding_review_status;
drop type if exists finding_severity;
drop type if exists finding_kind;
