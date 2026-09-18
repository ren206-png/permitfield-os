// Gate 4 (Quotes & Payments), Phase A -- pure eligibility logic for
// lib/inngest/functions/reminders.ts's cron poller.
//
// Extracted into its own pure, dependency-free module (no Supabase client,
// no Inngest `step`) specifically so it can be unit-tested directly --
// there is no existing precedent anywhere in this repo for testing an
// actual Inngest function body (grepping every *.test.ts file for
// `createFunction`/`inngest` turns up nothing), so rather than invent a
// novel Inngest-invocation test harness for this one function, the design
// instead follows lib/inngest/functions/audit.ts's own existing
// precedent of splitting out a pure, model-free/DB-free helper
// (computeMissingDocumentFindings) that IS unit-testable, and keeping the
// untestable DB/Inngest-step wiring as thin glue around it.
//
// GATE_4_FINDINGS.md §5's resolved decision (per this task's brief): never
// trust a stale reminder_jobs snapshot -- re-derive eligibility live, at
// fire time, from the *current* state of the underlying estimate/invoice.
// These functions are exactly that re-derivation, taking a freshly-loaded
// snapshot (reminders.ts's job) and returning a yes/no + reason.

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';
export type InvoiceStatus = 'draft' | 'issued' | 'void';

export interface ReminderEligibilityResult {
  eligible: boolean;
  /** Always populated, on both branches -- an ineligible result's reason
   * becomes reminder_jobs.status = 'skipped' bookkeeping in reminders.ts
   * (nothing here writes to the DB itself). */
  reason: string;
}

/**
 * "estimate_expiring" is the only estimate-kind reminder this pass sends.
 * Only a `sent` estimate can plausibly still be worth nudging a client
 * about -- draft was never sent, and accepted/declined/expired/void have
 * all already reached a terminal outcome that a reminder cannot change.
 */
export function evaluateEstimateReminderEligibility(status: EstimateStatus): ReminderEligibilityResult {
  if (status === 'sent') {
    return { eligible: true, reason: 'Estimate is still sent and awaiting a client response.' };
  }
  return { eligible: false, reason: `Estimate status is "${status}", no longer eligible for an expiring reminder.` };
}

export interface PaymentAllocationForEligibility {
  amountCents: bigint;
  /** The *payment's* own status (payments.status), not the allocation's
   * own row -- payment_allocations has no status column of its own; see
   * sumRecordedAllocationCents()'s own comment below and
   * supabase/migrations/20260806000056_payments.sql's header comment for
   * why a reversed payment's allocations must be excluded from "amount
   * paid." */
  paymentStatus: 'recorded' | 'reversed';
}

/**
 * Sums only the allocations belonging to a still-`recorded` payment,
 * excluding any belonging to a `reversed` one -- the exact rule
 * 20260806000056_payments.sql's own header comment prescribes for
 * deriving "how much of this invoice has actually been paid," since
 * `invoices` carries no paid/unpaid status column of its own.
 */
export function sumRecordedAllocationCents(allocations: PaymentAllocationForEligibility[]): bigint {
  return allocations.reduce(
    (total, allocation) => (allocation.paymentStatus === 'recorded' ? total + allocation.amountCents : total),
    0n
  );
}

export interface InvoiceReminderSnapshot {
  status: InvoiceStatus;
  /** Sum of recorded-only payment_allocations for this invoice -- see
   * sumRecordedAllocationCents() above; callers compute this from a live
   * query, never from a cached/denormalized total. */
  paidCents: bigint;
  /** invoices.issued_total_cents -- null for a draft (issue_invoice() sets
   * it), in which case this function is never eligible regardless. */
  issuedTotalCents: bigint | null;
}

/**
 * "invoice_due_soon" and "invoice_overdue" share this one check: eligible
 * only while the invoice is still `issued` (not `void`, and not `draft`
 * -- a draft has no due date at all) AND still has an outstanding
 * balance. An invoice that has been fully paid, even if never explicitly
 * marked anything-paid at the row level, must never receive a "please pay"
 * reminder -- re-deriving this live at fire time (rather than trusting
 * reminder_jobs' send_after alone) is exactly the point of this function.
 */
export function evaluateInvoiceReminderEligibility(snapshot: InvoiceReminderSnapshot): ReminderEligibilityResult {
  if (snapshot.status !== 'issued') {
    return { eligible: false, reason: `Invoice status is "${snapshot.status}", no longer eligible for a payment reminder.` };
  }
  if (snapshot.issuedTotalCents === null) {
    return { eligible: false, reason: 'Invoice has no issued total recorded; cannot determine outstanding balance.' };
  }
  const outstandingCents = snapshot.issuedTotalCents - snapshot.paidCents;
  if (outstandingCents <= 0n) {
    return { eligible: false, reason: 'Invoice is already fully paid.' };
  }
  return { eligible: true, reason: `Invoice still has an outstanding balance of ${outstandingCents} cents.` };
}
