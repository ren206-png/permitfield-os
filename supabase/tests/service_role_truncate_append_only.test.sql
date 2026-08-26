-- Proves 20260806000033_revoke_service_role_truncate_append_only.sql closes
-- the gap described in that migration's header: service_role held TRUNCATE
-- on every append-only table (extractions, audits, audit_findings,
-- generated_documents, audit_logs, application_status_history,
-- document_revisions) via Supabase's platform-default grant
-- (SERVICE_ROLE_GRANTS_FINDINGS.md), and none of those tables' row-level
-- forbid_update_delete()/forbid_delete()/audit_findings_restrict_update()
-- triggers fire on TRUNCATE -- so TRUNCATE was a live, silent way to erase
-- this platform's own audit trail and every other append-only ledger,
-- completely bypassing all of it.
--
-- Control-then-assert, inverted shape -- same reasoning as
-- bridge_read_grants.test.sql (20260806000032), but mirrored: that file
-- tests a migration ADDING a capability (control = grant absent, fails;
-- assert = grant restored, succeeds). This migration REMOVES one, so:
--   (a) control -- temporarily re-grant TRUNCATE (simulating the state
--       before this migration existed) and confirm service_role really
--       could TRUNCATE all seven tables -- proving the gap was real, not
--       merely asserted from reading a grants file.
--   (b) assert -- revoke again (restoring this migration's actual,
--       already-applied effect) and confirm the identical TRUNCATE now
--       fails with insufficient_privilege.
--
-- All seven tables are truncated together in one statement, in both the
-- control and assert steps, because audit_findings.audit_id references
-- audits(id) -- Postgres rejects `truncate audits` on its own (regardless
-- of privilege) if a table with an unlisted incoming foreign key exists;
-- listing every table in one TRUNCATE statement (which this migration's
-- own revoke list already enumerates) satisfies that without CASCADE.
-- Confirmed via grep that no table outside this set of seven has a foreign
-- key into any of them, so no other tables need to be included.
--
-- TRUNCATE is transactional in Postgres (unlike some other databases), so
-- wrapping this whole file in begin/rollback -- same convention as every
-- other file in this directory -- fully undoes the control step's actual
-- truncation of live seed rows (organizations' audit_logs, application
-- fixtures' application_status_history row, etc.) along with the
-- GRANT/REVOKE/SET ROLE DDL. Each *.test.sql file also runs as its own
-- psql invocation / connection (scripts/run-sql-tests.sh), so nothing here
-- is visible to any other test file even mid-run.
--
-- Runs as the connecting role (postgres, local superuser and owner of all
-- seven tables) to perform the GRANT/REVOKE DDL, then SET ROLE
-- service_role for each TRUNCATE attempt -- identical pattern to
-- bridge_read_grants.test.sql and audit_logs_external_actor.test.sql.

begin;

-- Step 1 (control): temporarily re-grant TRUNCATE on all seven tables,
-- simulating the platform-default state this migration closes, and
-- confirm service_role can actually truncate them -- the gap this
-- migration fixes was live, not hypothetical.
grant truncate on extractions, audits, audit_findings, generated_documents,
  audit_logs, application_status_history, document_revisions to service_role;

set role service_role;

do $$
begin
  execute 'truncate table extractions, audits, audit_findings, generated_documents, '
       || 'audit_logs, application_status_history, document_revisions';
  raise notice 'PASS (control): service_role TRUNCATE succeeded on all seven append-only tables while the grant is present -- confirms the platform-default gap this migration closes was real and reachable, not merely asserted from reading a grants file.';
exception
  when insufficient_privilege then
    raise exception 'FAIL (control): service_role TRUNCATE was rejected even with the grant present -- the later failure assertion would prove nothing without this control succeeding first. (%)', sqlerrm;
end $$;

reset role;

-- Step 2: revoke again, restoring this migration's actual (already
-- applied, pre-existing) effect for the assert step below.
revoke truncate on extractions, audits, audit_findings, generated_documents,
  audit_logs, application_status_history, document_revisions from service_role;

-- Step 3 (assert): the identical TRUNCATE now fails with
-- insufficient_privilege -- proving 20260806000033's revoke actually
-- closes the gap, not just that the migration file contains the right
-- statements.
set role service_role;

do $$
begin
  execute 'truncate table extractions, audits, audit_findings, generated_documents, '
       || 'audit_logs, application_status_history, document_revisions';
  raise exception 'FAIL (assert): service_role TRUNCATE succeeded on the append-only tables after the grant was revoked -- the TRUNCATE gap this migration was meant to close is still open.';
exception
  when insufficient_privilege then
    raise notice 'PASS (assert): service_role TRUNCATE on all seven append-only tables correctly rejected (permission denied) once the grant is revoked. (%)', sqlerrm;
end $$;

reset role;

rollback;
