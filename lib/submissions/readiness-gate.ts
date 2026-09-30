// With the Permit progress panel on (PERMITFIELD_FF_READINESS), an
// application may be submitted to an authority only once its permit status
// has reached Ready to submit -- the step the readiness checklist (or a
// recorded override) gates. Later statuses stay allowed so a permit type with
// several filings (e.g. Toronto + ESA) can still send its second filing after
// the first one moved the status to Submitted, and a revision can be resent.
const SUBMITTABLE_PERMIT_STATUSES = new Set([
  'ready_to_submit',
  'submitted',
  'under_municipal_review',
  'revision_requested',
  'resubmitted',
]);

export function submissionBlockedByReadiness(permitStatus: string | null, readinessEnabled: boolean): string | null {
  if (!readinessEnabled) return null;
  if (permitStatus && SUBMITTABLE_PERMIT_STATUSES.has(permitStatus)) return null;
  return 'Move the permit status to Ready to submit first (Permit progress, above) -- that is where the checklist and sign-off happen.';
}
