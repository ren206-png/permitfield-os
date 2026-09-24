// Deadline/expiry alerts, slice 2 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Pure send_after computation for a permit's expiry
// reminder_job -- sibling to contractor-license-schedule.ts's
// computeContractorLicenseReminderSendAfter(), same split rationale (that
// file's own header comment) and the same 30-day lead time, chosen for
// consistency across both deadline-alert kinds rather than any
// permit-specific research -- no jurisdiction-modeled renewal window
// exists in this schema to derive a different number from (see
// 20260806000066_permit_expiry_reminders.sql's header comment).
//
// Not clamped to "now" either, for the identical reason
// contractor-license-schedule.ts's own header comment gives: a permit
// expiring inside the lead window should warn immediately on the poller's
// next run, not silently skip a reminder.
export const PERMIT_EXPIRY_REMINDER_LEAD_DAYS = 30;

/**
 * @param permitExpiresOnIso - a `date`-typed value as returned by
 *   PostgREST, i.e. `YYYY-MM-DD` (no time-of-day component).
 * @returns an ISO-8601 timestamp string suitable for reminder_jobs.send_after.
 */
export function computePermitExpiryReminderSendAfter(permitExpiresOnIso: string): string {
  const expiresOn = new Date(`${permitExpiresOnIso}T00:00:00.000Z`);
  const sendAfter = new Date(expiresOn.getTime() - PERMIT_EXPIRY_REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);
  return sendAfter.toISOString();
}
