-- Deadline/expiry alerts, slice 1 of 2 (MARKETING_CAPABILITY_LEDGER.md §17
-- follow-up: "license-expiry field is a plain date input with no reminder
-- logic" -- this migration is that reminder logic's schema half).
--
-- Scope note (why this is contractor-license-only, not also permit
-- expiry): permit_applications has an 'expired' *status*
-- (20260806000022_permit_status_machine.sql) but no expiry *date* column
-- and no jurisdiction-modeled validity period anywhere in this schema --
-- there is nothing to compute a reminder date from yet. contractors.
-- license_expires_on (20260806000003_contractors.sql:14) already has a
-- real date, captured at creation, that nothing reads back
-- (lib/quotes-payments/reminder-labels.ts's own header comment and a
-- repo-wide grep both confirm license_expires_on is write-only today).
-- Permit expiry is deliberately left for a separate follow-up once that
-- product decision (manual field vs. jurisdiction-computed) is made.
--
-- Reuses reminder_jobs/reminder_delivery_attempts
-- (20260806000057_reminder_jobs.sql) rather than a new table: that
-- migration's own header comment sized this schema generically ("what a
-- reminder should say and to whom"), and reminder-labels.ts's header
-- comment flags that, as of this pass, NOTHING has ever inserted a
-- reminder_jobs row for any kind -- the poller
-- (lib/inngest/functions/reminders.ts) and this UI have always read an
-- empty table. This migration adds the first real producer (see
-- app/(app)/contractors/new/actions.ts), for the 'contractor' target only.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside any other DDL
-- in the same transaction as a later USE of that value -- see
-- 20260806000012's header comment. This file never uses
-- 'contractor_license_expiring' in a DML statement itself (only the
-- application code and a future migration would), so it is safe to add
-- the value and keep going in the same file, same precedent as
-- 20260806000063's own note on this.
alter type reminder_job_kind add value 'contractor_license_expiring';

-- target_kind's CHECK was authored for exactly two values
-- (20260806000057_reminder_jobs.sql:36) -- widen it to admit 'contractor'
-- alongside the existing 'estimate'/'invoice'. No RLS/grant change needed:
-- reminder_jobs_insert (same migration) already gates on
-- is_org_member(org_id), not on target_kind.
alter table reminder_jobs drop constraint reminder_jobs_target_kind_check;
alter table reminder_jobs add constraint reminder_jobs_target_kind_check
  check (target_kind in ('estimate', 'invoice', 'contractor'));
