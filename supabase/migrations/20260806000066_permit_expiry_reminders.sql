-- Deadline/expiry alerts, slice 2 of 2 (MARKETING_CAPABILITY_LEDGER.md §17
-- follow-up, closing the scope gap 20260806000065's own header comment
-- deliberately left open: "permit_applications has no expiry *date*
-- column and no jurisdiction-modeled validity period anywhere in this
-- schema -- there is nothing to compute a reminder date from yet").
--
-- Product decision (manual field vs. jurisdiction-computed), now made:
-- manual field, same as contractors.license_expires_on
-- (20260806000003_contractors.sql:14) -- a jurisdiction-modeled validity
-- period (e.g. "electrical permits in Toronto are valid for N months
-- after issuance") does not exist anywhere in this schema's jurisdiction
-- tables (20260806000004, 20260806000026/000027) and building it is a
-- separate, much larger effort. A plain nullable date column, set/cleared
-- by an org member on the application detail page and re-derived live at
-- send time (never trusted as a frozen snapshot -- see
-- reminder-eligibility.ts's own header comment), mirrors the exact shape
-- that already shipped for contractors and needs no jurisdiction data
-- modeling to be correct.
--
-- Why this land on permit_applications and not permit_status/
-- application_status: neither status column represents "this permit, once
-- issued, is valid until date X" -- application_status is the AI-pipeline
-- progress column (draft..submitted) and permit_status is currently
-- dormant infrastructure with zero call sites anywhere in app/
-- (lib/permit-status/transitions.ts's own header comment). A permit can
-- have a known expiry date independent of whether either status machine
-- has ever been advanced past its current value, so this is a new column,
-- not a derived read of either enum.
alter table permit_applications add column permit_expires_on date;

-- Same reasoning as 20260806000065's own reminder_job_kind/target_kind
-- widening: add the new kind, then widen the pre-existing target_kind
-- CHECK (already widened once from 2 to 3 values by 20260806000065) to
-- admit a 4th. No DML in this file uses 'permit_expiring', so the
-- ALTER TYPE ... ADD VALUE / same-transaction-DDL rule
-- (20260806000012's header comment) is satisfied the same way it was
-- there.
alter type reminder_job_kind add value 'permit_expiring';

alter table reminder_jobs drop constraint reminder_jobs_target_kind_check;
alter table reminder_jobs add constraint reminder_jobs_target_kind_check
  check (target_kind in ('estimate', 'invoice', 'contractor', 'permit'));
