-- Follow-up to SERVICE_ROLE_GRANTS_FINDINGS.md (2026-08-26): that finding
-- established service_role holds the full privilege set (DELETE, INSERT,
-- REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) on every public-schema
-- table by Supabase platform default, independent of this repo's own
-- narrower grants, and deferred the question of whether to pursue
-- least-privilege hardening as a separate, unscoped future project (§6).
--
-- This migration is the one slice of that deferred work pulled forward,
-- because it closes a concrete, live gap in this codebase's own
-- tamper-evidence design rather than being a generic hardening pass.
--
-- The gap: every append-only table in this schema enforces its "rows are
-- never mutated/deleted" guarantee with a ROW-LEVEL trigger --
-- forbid_update_delete() (20260806000007), forbid_delete() plus
-- audit_findings_restrict_update() (20260806000009), and the same
-- forbid_update_delete() reused on 20260806000017, 20260806000018,
-- 20260806000022, and 20260806000024. Row-level triggers
-- (`for each row`) never fire on TRUNCATE -- only a statement-level
-- `before truncate` trigger or an event trigger would, and grepping every
-- migration in this repo for "truncate" turns up zero results: nothing
-- here has ever guarded against it. Meanwhile service_role holds TRUNCATE
-- on every one of these tables today, per the platform default cited
-- above -- including audit_logs, this platform's own audit trail.
-- Concretely: `truncate audit_logs;`, run with the service-role key,
-- currently erases the entire audit trail in one statement, silently and
-- irrecoverably, with none of the UPDATE/DELETE protections above able to
-- stop it. For a platform that files permits with government
-- jurisdictions on a client's behalf, an audit trail that can be
-- instantly wiped is a real gap, not a theoretical one.
--
-- Fix: revoke TRUNCATE from service_role on exactly the seven tables that
-- carry one of the append-only triggers above -- the tables whose entire
-- design premise this closes a hole in, not a blanket 34-table pass (that
-- remains the separately-scoped, not-yet-decided project in
-- SERVICE_ROLE_GRANTS_FINDINGS.md §6). UPDATE/DELETE are deliberately left
-- alone here: the row-level triggers already reject both for service_role
-- exactly as they do for every other role (proven live in
-- supabase/tests/service_role_truncate_append_only.test.sql, this same
-- branch), so revoking them here would be redundant, not defense-in-depth.
-- TRUNCATE is the only privilege in this set with no other enforcement
-- layer behind it.
--
-- Scoped to:
--   extractions                 (20260806000007, forbid_update_delete)
--   audits                      (20260806000009, forbid_update_delete)
--   audit_findings               (20260806000009, forbid_delete)
--   generated_documents          (20260806000017, forbid_update_delete)
--   audit_logs                   (20260806000018, forbid_update_delete)
--   application_status_history   (20260806000022, forbid_update_delete)
--   document_revisions           (20260806000024, forbid_update_delete)
--
-- RLS is not the relevant layer here, same reasoning as every other
-- service_role grant/revoke in this codebase: service_role has BYPASSRLS
-- (20260806000015's header), so table-level privilege is the entire
-- enforcement surface for this role on these tables. A plain `revoke`
-- removes the privilege regardless of whether it originated from this
-- repo's own migrations or Supabase's platform-default bootstrap grant --
-- it does not need to match how the grant was originally issued.
revoke truncate on extractions from service_role;
revoke truncate on audits from service_role;
revoke truncate on audit_findings from service_role;
revoke truncate on generated_documents from service_role;
revoke truncate on audit_logs from service_role;
revoke truncate on application_status_history from service_role;
revoke truncate on document_revisions from service_role;
