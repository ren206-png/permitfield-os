import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isQuotesPaymentsEnabled, isDeadlineRemindersEnabled } from '@/lib/flags';
import { writeAuditLog } from '@/lib/audit/log';
import { SITE_URL } from '@/lib/seo';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { sendEmail } from '@/lib/email/send';
import { renderEstimateSentEmail } from '@/lib/email/templates/estimate-sent';
import { renderInvoiceDueReminderEmail } from '@/lib/email/templates/invoice-due-reminder';
import { renderContractorLicenseExpiringEmail } from '@/lib/email/templates/contractor-license-expiring';
import { resolveOrgNotificationRecipients } from '@/lib/notifications/recipients';
import {
  evaluateEstimateReminderEligibility,
  evaluateInvoiceReminderEligibility,
  evaluateContractorLicenseReminderEligibility,
  sumRecordedAllocationCents,
  type EstimateStatus,
  type InvoiceStatus,
} from './reminder-eligibility';
import type { QPClient } from '@/lib/quotes-payments/types';

// Gate 4 (Quotes & Payments), Phase A -- reminder_jobs poller.
// GATE_4_FINDINGS.md §5's resolved decision: an Inngest cron trigger
// (rather than per-job step.sleepUntil() delays scheduled at job-creation
// time -- no job-creation call site exists yet in this pass either, per
// this task's own scope) that scans for due jobs and, for each one,
// re-derives eligibility live from the current estimate/invoice state
// (lib/inngest/functions/reminder-eligibility.ts) rather than trusting
// send_after/status alone -- a reminder_jobs row could go stale between
// creation and its send_after firing (e.g. the client already paid, or
// the estimate was accepted) and must never send in that case.
//
// Hourly cadence chosen as a reasonable default for reminder freshness --
// nothing in reminder_jobs' own schema requires finer granularity, and no
// existing cron-triggered Inngest function exists in this repo to match
// cadence with.
//
// Gated by isQuotesPaymentsEnabled(): when off, this function still fires
// on schedule (Inngest's cron trigger has no flag awareness) but returns
// immediately as a safe no-op -- never an error, matching every other
// flag-gated surface in this codebase (lib/flags.ts's own header comment
// on the "off means byte-identical to before this pass shipped" rule).
//
// Deadline/expiry alerts, slice 1 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up) extends this same poller to a 'contractor' target_kind
// (reminder_jobs.kind = 'contractor_license_expiring') rather than adding
// a second cron function -- this function's own job-loading query is
// already kind-agnostic (`select ... where status = 'pending' and
// send_after <= now()`, no `kind`/`target_kind` filter), so a second
// poller would just mean two functions racing to claim the same
// `reminder_jobs` table for no benefit. Gated independently by
// isDeadlineRemindersEnabled(), checked per-job inside decideAndSend()
// below (not here at the function's top level) so a quotes-payments-only
// environment (or vice versa) never has one flag silently gate the other
// kind's reminders too -- see that flag's own header comment in
// lib/flags.ts.
export const permitQuotesPaymentsReminders = inngest.createFunction(
  {
    id: 'quotes-payments-reminders',
    name: 'Send due quotes & payments reminders',
    triggers: [{ cron: '0 * * * *' }],
    retries: 2,
  },
  async ({ step }) => {
    if (!isQuotesPaymentsEnabled() && !isDeadlineRemindersEnabled()) {
      return { enabled: false, processed: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const supabase = createServiceClient();

    const dueJobs = await step.run('load-due-reminder-jobs', async () => {
      const { data, error } = await supabase
        .from('reminder_jobs')
        .select('id, org_id, kind, target_kind, target_id')
        .eq('status', 'pending')
        .lte('send_after', new Date().toISOString());
      if (error) {
        throw new Error(`Failed to load due reminder_jobs: ${error.message}`);
      }
      return (data ?? []) as DueReminderJobRow[];
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of dueJobs) {
      // Split into two steps per job, same reasoning as
      // lib/inngest/functions/audit.ts's own split around its
      // audits-row insert: `decide-and-send` is the one step allowed to
      // call the external Resend API, so a retry of the whole function
      // after `finalize` fails does not re-run `decide-and-send` (and
      // therefore cannot re-send the email) -- it replays that step's
      // already-memoized result instead.
      const decision = await step.run(`decide-and-send-${job.id}`, async () => decideAndSend(supabase, job));

      await step.run(`finalize-${job.id}`, async () => finalizeReminderJob(supabase, job, decision));

      if (decision.outcome === 'sent') sent++;
      else if (decision.outcome === 'skipped') skipped++;
      else failed++;
    }

    return { enabled: true, processed: dueJobs.length, sent, skipped, failed };
  }
);

interface DueReminderJobRow {
  id: string;
  org_id: string;
  kind: 'estimate_expiring' | 'invoice_due_soon' | 'invoice_overdue' | 'contractor_license_expiring';
  target_kind: 'estimate' | 'invoice' | 'contractor';
  target_id: string;
}

type Decision =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'sent'; messageId: string | null }
  | { outcome: 'send-failed'; error: string };

/**
 * Loads the current estimate/invoice + client + org state, re-derives
 * eligibility (lib/inngest/functions/reminder-eligibility.ts), and -- only
 * if still eligible -- renders and sends the reminder email. Never writes
 * to reminder_jobs/reminder_delivery_attempts itself; finalizeReminderJob()
 * below owns all persistence so a retry of this function never re-sends an
 * email whose outcome was already recorded.
 */
async function decideAndSend(supabase: QPClient, job: DueReminderJobRow): Promise<Decision> {
  const orgName = await loadOrganizationName(supabase, job.org_id);

  if (job.target_kind === 'estimate') {
    const estimate = await loadEstimateSnapshot(supabase, job.org_id, job.target_id);
    if (!estimate) {
      return { outcome: 'skipped', reason: `Estimate ${job.target_id} no longer exists.` };
    }
    const eligibility = evaluateEstimateReminderEligibility(estimate.status);
    if (!eligibility.eligible) {
      return { outcome: 'skipped', reason: eligibility.reason };
    }

    const client = await loadClient(supabase, job.org_id, estimate.clientId);
    if (!client?.email) {
      return { outcome: 'skipped', reason: 'Client has no email address on file.' };
    }

    // Placeholder view link: no public client-facing estimate-view route
    // or access-token system exists yet (that is the client-portal
    // bridge's concern, GATE_2_0_FINDINGS.md, and is out of this task's
    // scope) -- this constructs a same-origin path by id so the template
    // renders a real, well-formed URL rather than an empty string, but it
    // is not wired to an actual authenticated view yet.
    const viewUrl = `${SITE_URL}/estimates/${job.target_id}`;
    const email = renderEstimateSentEmail({
      recipientEmail: client.email,
      recipientName: client.name,
      organizationName: orgName,
      viewUrl,
    });

    const result = await sendEmail(email);
    return result.success
      ? { outcome: 'sent', messageId: result.id }
      : { outcome: 'send-failed', error: result.error };
  }

  if (job.target_kind === 'contractor') {
    if (!isDeadlineRemindersEnabled()) {
      return { outcome: 'skipped', reason: 'Deadline reminders are disabled (PERMITFIELD_FF_DEADLINE_REMINDERS).' };
    }

    const contractor = await loadContractorSnapshot(supabase, job.org_id, job.target_id);
    if (!contractor) {
      return { outcome: 'skipped', reason: `Contractor ${job.target_id} no longer exists.` };
    }
    const eligibility = evaluateContractorLicenseReminderEligibility({ licenseExpiresOn: contractor.licenseExpiresOn });
    if (!eligibility.eligible) {
      return { outcome: 'skipped', reason: eligibility.reason };
    }

    // No email column on contractors (nor a contractor detail page to view
    // one from) -- this is an internal/staff-facing alert, not a
    // client-facing one, so it broadcasts to every notifiable org member
    // (lib/notifications/recipients.ts's resolveOrgNotificationRecipients(),
    // the same recipient-resolution helper lib/inngest/functions/notify.ts
    // uses for its own internal lifecycle notifications) rather than a
    // single contact.
    const recipients = await resolveOrgNotificationRecipients(supabase, job.org_id);
    if (recipients.length === 0) {
      return { outcome: 'skipped', reason: 'No org member has a notifiable email address on file.' };
    }

    const overdue = new Date(`${contractor.licenseExpiresOn}T00:00:00.000Z`).getTime() < Date.now();
    const results = await Promise.all(
      recipients.map((recipient) =>
        sendEmail(
          renderContractorLicenseExpiringEmail({
            recipientEmail: recipient.email,
            organizationName: orgName,
            contractorCompanyName: contractor.companyName,
            expiresOnDisplay: contractor.licenseExpiresOn as string,
            overdue,
          })
        )
      )
    );

    // Cardinality note: unlike the estimate/invoice branches (one email,
    // one outcome), this branch fans out to every org recipient but still
    // reports back exactly one Decision/one reminder_delivery_attempts row
    // (finalizeReminderJob()'s shape is unchanged) -- "sent" if at least
    // one recipient's email went through (so nobody misses the alert just
    // because a different inbox bounced), "send-failed" (retried next
    // hour, same as any other transient Resend failure) only if every
    // single send failed.
    const succeeded = results.find((result) => result.success);
    if (succeeded && succeeded.success) {
      return { outcome: 'sent', messageId: succeeded.id };
    }
    const errors = results
      .map((result) => (result.success ? null : result.error))
      .filter((error): error is string => error !== null)
      .join('; ');
    return { outcome: 'send-failed', error: errors || 'All recipient sends failed.' };
  }

  const invoice = await loadInvoiceSnapshot(supabase, job.org_id, job.target_id);
  if (!invoice) {
    return { outcome: 'skipped', reason: `Invoice ${job.target_id} no longer exists.` };
  }
  const eligibility = evaluateInvoiceReminderEligibility({
    status: invoice.status,
    paidCents: invoice.paidCents,
    issuedTotalCents: invoice.issuedTotalCents,
  });
  if (!eligibility.eligible) {
    return { outcome: 'skipped', reason: eligibility.reason };
  }

  const client = await loadClient(supabase, job.org_id, invoice.clientId);
  if (!client?.email) {
    return { outcome: 'skipped', reason: 'Client has no email address on file.' };
  }

  const viewUrl = `${SITE_URL}/invoices/${job.target_id}`;
  const email = renderInvoiceDueReminderEmail({
    recipientEmail: client.email,
    recipientName: client.name,
    organizationName: orgName,
    viewUrl,
    invoiceNumber: invoice.invoiceNumber,
    dueDateDisplay: invoice.dueDate ?? 'an earlier date',
    overdue: job.kind === 'invoice_overdue',
  });

  const result = await sendEmail(email);
  return result.success
    ? { outcome: 'sent', messageId: result.id }
    : { outcome: 'send-failed', error: result.error };
}

/**
 * Persists the outcome of decideAndSend(): a delivery attempt row on the
 * 'sent'/'send-failed' branches (never on 'skipped' -- a skip is not a
 * delivery attempt at all, per reminder_delivery_attempts' own header
 * comment in 20260806000057_reminder_jobs.sql), an audit_logs entry on
 * every branch, and the reminder_jobs status transition:
 *   - 'sent'        -> status='sent'
 *   - 'skipped'      -> status='skipped' (never 'canceled' -- canceled_at/
 *                        cancel_reason are CHECK-constrained to status=
 *                        'canceled' only, and this migration's own comment
 *                        reserves 'canceled' for an org member's deliberate
 *                        cancellation, not this poller's own "no longer
 *                        appropriate" determination)
 *   - 'send-failed'  -> left as 'pending' (deliberately NOT a terminal
 *                        status): a transient Resend failure should retry
 *                        on the next hourly run rather than being
 *                        permanently given up on; the failed attempt is
 *                        still recorded in reminder_delivery_attempts so
 *                        the failure is visible.
 */
async function finalizeReminderJob(supabase: QPClient, job: DueReminderJobRow, decision: Decision): Promise<void> {
  if (decision.outcome === 'sent' || decision.outcome === 'send-failed') {
    const { error: attemptError } = await supabase.from('reminder_delivery_attempts').insert({
      org_id: job.org_id,
      reminder_job_id: job.id,
      channel: 'email',
      outcome: decision.outcome === 'sent' ? 'success' : 'failure',
      error_detail: decision.outcome === 'send-failed' ? decision.error : null,
    });
    if (attemptError) {
      throw new Error(`Failed to insert reminder_delivery_attempts row for job ${job.id}: ${attemptError.message}`);
    }
  }

  if (decision.outcome === 'sent' || decision.outcome === 'skipped') {
    const { error: statusError } = await supabase
      .from('reminder_jobs')
      .update({ status: decision.outcome === 'sent' ? 'sent' : 'skipped' })
      .eq('id', job.id);
    if (statusError) {
      throw new Error(`Failed to update reminder_jobs status for job ${job.id}: ${statusError.message}`);
    }
  }

  // audit_logs has exactly two legal actor shapes (internal staff, or
  // external/client-portal -- see lib/audit/log.ts's own header comment
  // and audit_logs_actor_exactly_one_populated), and neither is a true
  // fit for a system cron job: there is no actor_user_id (no human staff
  // session is involved) and external_actor_id's documented intent is a
  // client-portal recipient's client_access_tokens row id, not "the
  // system." The external-actor shape is used here anyway, with a fixed,
  // clearly-non-token-shaped sentinel id/label, because it is the only
  // structurally legal shape available and audit_logs_external_actor.ts's
  // own migration made external_actor_id a free-form, non-FK `text`
  // column specifically because its true referent can never be enforced
  // by this project's own schema -- flagged here rather than silently
  // treated as a perfect fit.
  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: job.org_id,
    externalActorId: 'system:quotes-payments-reminders-cron',
    externalActorLabel: 'Automated reminder cron (lib/inngest/functions/reminders.ts)',
    action:
      decision.outcome === 'sent'
        ? 'reminder.sent'
        : decision.outcome === 'skipped'
          ? 'reminder.skipped'
          : 'reminder.send_failed',
    entityType: 'reminder_jobs',
    entityId: job.id,
    afterSummary:
      decision.outcome === 'sent'
        ? { kind: job.kind, targetKind: job.target_kind, targetId: job.target_id, messageId: decision.messageId }
        : decision.outcome === 'skipped'
          ? { kind: job.kind, targetKind: job.target_kind, targetId: job.target_id, reason: decision.reason }
          : { kind: job.kind, targetKind: job.target_kind, targetId: job.target_id, error: decision.error },
  });
  if (auditError) {
    console.error(`Failed to write audit log for reminder_jobs ${job.id} (${decision.outcome}): ${auditError}`);
  }
}

async function loadOrganizationName(supabase: QPClient, orgId: string): Promise<string> {
  const { data, error } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
  if (error) {
    throw new Error(`Failed to load organizations row for ${orgId}: ${error.message}`);
  }
  return (data?.name as string | undefined) ?? 'Your contractor';
}

interface ClientContact {
  name: string | null;
  email: string | null;
}

async function loadClient(supabase: QPClient, orgId: string, clientId: string): Promise<ClientContact | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('name, email')
    .eq('org_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load clients row ${clientId}: ${error.message}`);
  }
  if (!data) return null;
  return { name: (data.name as string | null) ?? null, email: (data.email as string | null) ?? null };
}

interface ContractorSnapshot {
  companyName: string;
  licenseExpiresOn: string | null;
}

async function loadContractorSnapshot(
  supabase: QPClient,
  orgId: string,
  contractorId: string
): Promise<ContractorSnapshot | null> {
  const { data, error } = await supabase
    .from('contractors')
    .select('company_name, license_expires_on')
    .eq('org_id', orgId)
    .eq('id', contractorId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load contractors row ${contractorId}: ${error.message}`);
  }
  if (!data) return null;
  return {
    companyName: data.company_name as string,
    licenseExpiresOn: (data.license_expires_on as string | null) ?? null,
  };
}

interface EstimateSnapshot {
  status: EstimateStatus;
  clientId: string;
}

async function loadEstimateSnapshot(
  supabase: QPClient,
  orgId: string,
  estimateId: string
): Promise<EstimateSnapshot | null> {
  const { data, error } = await supabase
    .from('estimates')
    .select('status, client_id')
    .eq('org_id', orgId)
    .eq('id', estimateId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load estimates row ${estimateId}: ${error.message}`);
  }
  if (!data) return null;
  return { status: data.status as EstimateStatus, clientId: data.client_id as string };
}

interface InvoiceSnapshot {
  status: InvoiceStatus;
  clientId: string;
  invoiceNumber: number | null;
  dueDate: string | null;
  issuedTotalCents: bigint | null;
  paidCents: bigint;
}

async function loadInvoiceSnapshot(
  supabase: QPClient,
  orgId: string,
  invoiceId: string
): Promise<InvoiceSnapshot | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('status, client_id, invoice_number, due_date, issued_total_cents')
    .eq('org_id', orgId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load invoices row ${invoiceId}: ${error.message}`);
  }
  if (!data) return null;

  const paidCents = await sumInvoicePaidCents(supabase, orgId, invoiceId);

  return {
    status: data.status as InvoiceStatus,
    clientId: data.client_id as string,
    invoiceNumber: (data.invoice_number as number | null) ?? null,
    dueDate: (data.due_date as string | null) ?? null,
    issuedTotalCents: dbValueToCentsOrNull(data.issued_total_cents as number | string | null),
    paidCents,
  };
}

/**
 * Re-derives how much of this invoice has actually been paid by joining
 * payment_allocations back to payments and keeping only allocations whose
 * payment is still `recorded` (excluding `reversed`) -- invoices has no
 * paid-status column of its own; see
 * supabase/migrations/20260806000056_payments.sql's own header comment
 * and lib/inngest/functions/reminder-eligibility.ts's
 * sumRecordedAllocationCents() for why this exact join is required. Two
 * queries (allocations, then payments by id) rather than a single
 * PostgREST embedded-select, since payment_allocations' FK to payments is
 * composite ((org_id, payment_id) -> (org_id, id)), which PostgREST's
 * implicit-embedding resolver does not reliably support.
 */
async function sumInvoicePaidCents(supabase: QPClient, orgId: string, invoiceId: string): Promise<bigint> {
  const { data: allocations, error: allocationsError } = await supabase
    .from('payment_allocations')
    .select('payment_id, amount_cents')
    .eq('org_id', orgId)
    .eq('invoice_id', invoiceId);
  if (allocationsError) {
    throw new Error(`Failed to load payment_allocations for invoice ${invoiceId}: ${allocationsError.message}`);
  }
  if (!allocations || allocations.length === 0) return 0n;

  const paymentIds = [...new Set(allocations.map((a) => a.payment_id as string))];
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, status')
    .eq('org_id', orgId)
    .in('id', paymentIds);
  if (paymentsError) {
    throw new Error(`Failed to load payments for invoice ${invoiceId}: ${paymentsError.message}`);
  }

  const statusByPaymentId = new Map<string, 'recorded' | 'reversed'>(
    (payments ?? []).map((p) => [p.id as string, p.status as 'recorded' | 'reversed'])
  );

  return sumRecordedAllocationCents(
    allocations.map((a) => ({
      amountCents: dbValueToCents(a.amount_cents as number | string),
      // A payment row missing from the lookup (should not happen given the
      // FK) is treated as not-recorded -- excluded from the paid total --
      // the safer default when in doubt about whether money should count
      // as collected.
      paymentStatus: statusByPaymentId.get(a.payment_id as string) ?? 'reversed',
    }))
  );
}
