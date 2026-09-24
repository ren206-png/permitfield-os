// Deadline/expiry alerts, slice 1 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Pure send_after computation for a contractor's
// license-expiry reminder_job -- extracted from
// app/(app)/contractors/new/actions.ts's insert call site so the date
// arithmetic is unit-testable without a Supabase client, same
// "pure/dependency-free helper, thin glue around it" split
// lib/inngest/functions/reminder-eligibility.ts's own header comment
// documents for this codebase's reminder logic generally.
//
// 30-day lead time: no existing convention to match (this is the first
// reminder_jobs producer this codebase has ever had -- see
// 20260806000065_contractor_license_expiry_reminders.sql's header comment),
// chosen as a reasonable default long enough for a contractor to actually
// renew a license before it lapses. Deliberately not clamped to "now" when
// the expiry is already under 30 days away (or already past): send_after
// simply lands in the past, and lib/inngest/functions/reminders.ts's
// `send_after <= now()` poll query picks it up on its very next run --
// the right behavior is to warn immediately, not to silently drop the
// reminder for a license that's already close to (or past) expiring.
export const CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS = 30;

/**
 * Pure date arithmetic, no "clamp to now" step -- deliberately, per this
 * file's header comment: a license expiring in fewer than
 * CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS returns a send_after already in
 * the past, which is exactly what should happen (immediate reminder on
 * the poller's next run), not an error case to special-case around.
 *
 * @param licenseExpiresOnIso - a `date`-typed value as returned by
 *   PostgREST, i.e. `YYYY-MM-DD` (no time-of-day component).
 * @returns an ISO-8601 timestamp string suitable for reminder_jobs.send_after.
 */
export function computeContractorLicenseReminderSendAfter(licenseExpiresOnIso: string): string {
  const expiresOn = new Date(`${licenseExpiresOnIso}T00:00:00.000Z`);
  const sendAfter = new Date(expiresOn.getTime() - CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);
  return sendAfter.toISOString();
}
