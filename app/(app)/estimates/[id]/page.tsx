import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToDollarsString, multiplyCentsByFraction, parseDecimalQuantity } from '@/lib/money/cents';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';
import { EstimateStatusBadge } from '@/components/estimate-status-badge';
import { ReminderJobStatusBadge } from '@/components/reminder-job-status-badge';
import { LockedFeature } from '@/components/locked-feature';
import { reminderKindLabel } from '@/lib/quotes-payments/reminder-labels';
import { SendEstimateButton } from './send-estimate-button';
import { GenerateEstimateClientLinkButton } from './generate-client-link-button';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/applications/[id]/page.tsx's role as this feature's detail/view
// page. Renders the mutable draft line items while status = 'draft', or
// the immutable estimate_revisions snapshot (`line_items` jsonb, the exact
// shape lib/quotes-payments/tax-result.ts's serializeLineItemBreakdown()
// writes -- snake_case keys, cents as plain numbers) once sent -- never
// both, and never re-derives totals client-side; every number shown here is
// read directly off a row already computed by the service layer.
export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { id } = await params;
  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'quotes.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Estimates unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const supabase = await createClient();

  const { data: estimate, error } = await supabase
    .from('estimates')
    .select(
      'id, status, currency_code, expiry_date, scope_notes, exclusions, terms, current_revision_id, created_at, clients ( name )'
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load estimate: ${error.message}`);
  }
  if (!estimate) {
    notFound();
  }

  const client = Array.isArray(estimate.clients) ? estimate.clients[0] : estimate.clients;

  let lineItems: Array<{ description: string; quantity: string; total: string }> = [];
  let totals: { subtotal: string; discount: string; tax: string; total: string } | null = null;
  let revisionNumber: number | null = null;

  if (estimate.status === 'draft') {
    const { data: draftLineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select('description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
      .eq('org_id', orgId)
      .eq('estimate_id', id)
      .order('position', { ascending: true });
    if (lineItemsError) {
      throw new Error(`Failed to load line items: ${lineItemsError.message}`);
    }
    // Draft-stage display total only (pre-discount, pre-tax -- the domain
    // engine's actual, authoritative rounding sequence runs at send time,
    // lib/quotes-payments/tax-result.ts). Uses
    // multiplyCentsByFraction()/parseDecimalQuantity() rather than
    // `Number(quantity)` float math, matching this codebase's float-free
    // money discipline (lib/money/cents.ts's own header comment).
    lineItems = (draftLineItems ?? []).map((li) => {
      const quantityFraction = parseDecimalQuantity(li.quantity);
      const unitPriceCents = dbValueToCents(li.unit_price_cents);
      const lineTotalCents = quantityFraction ? multiplyCentsByFraction(unitPriceCents, quantityFraction) : 0n;
      return {
        description: li.description,
        quantity: li.quantity,
        total: centsToDollarsString(lineTotalCents),
      };
    });
  } else if (estimate.current_revision_id) {
    const { data: revision, error: revisionError } = await supabase
      .from('estimate_revisions')
      .select('revision_number, sent_at, line_items, subtotal_cents, discount_total_cents, tax_total_cents, total_cents')
      .eq('id', estimate.current_revision_id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (revisionError) {
      throw new Error(`Failed to load estimate revision: ${revisionError.message}`);
    }
    if (revision) {
      revisionNumber = revision.revision_number;
      const rawLineItems = Array.isArray(revision.line_items) ? revision.line_items : [];
      lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
        description: String(li.description ?? ''),
        quantity: String(li.quantity ?? ''),
        total: centsField(li, 'line_total_cents'),
      }));
      totals = {
        subtotal: centsField(revision, 'subtotal_cents'),
        discount: centsField(revision, 'discount_total_cents'),
        tax: centsField(revision, 'tax_total_cents'),
        total: centsField(revision, 'total_cents'),
      };
    }
  }

  // Reminder visibility. reminder_jobs/reminder_delivery_attempts
  // (supabase/migrations/20260806000057_reminder_jobs.sql) are both
  // already `authenticated`-readable via is_org_member(org_id) RLS -- no
  // schema change needed for this read, only a UI that hadn't existed
  // anywhere in the app until this pass. See reminder-labels.ts's header
  // comment for the important caveat: nothing currently ever inserts a
  // reminder_jobs row, so this will render "No reminders scheduled" for
  // every estimate today until a creation call site is added separately.
  const { data: reminderJobRows, error: reminderJobsError } = await supabase
    .from('reminder_jobs')
    .select('id, kind, status, send_after, cancel_reason')
    .eq('org_id', orgId)
    .eq('target_kind', 'estimate')
    .eq('target_id', id)
    .order('send_after', { ascending: true });
  if (reminderJobsError) {
    throw new Error(`Failed to load reminders: ${reminderJobsError.message}`);
  }

  const reminderJobIds = (reminderJobRows ?? []).map((job) => job.id);
  const attemptsByJobId = new Map<
    string,
    Array<{ id: string; outcome: string; errorDetail: string | null; attemptedAt: string }>
  >();
  if (reminderJobIds.length > 0) {
    const { data: attemptRows, error: attemptsError } = await supabase
      .from('reminder_delivery_attempts')
      .select('id, reminder_job_id, outcome, error_detail, attempted_at')
      .eq('org_id', orgId)
      .in('reminder_job_id', reminderJobIds)
      .order('attempted_at', { ascending: false });
    if (attemptsError) {
      throw new Error(`Failed to load reminder delivery attempts: ${attemptsError.message}`);
    }
    for (const row of attemptRows ?? []) {
      const list = attemptsByJobId.get(row.reminder_job_id) ?? [];
      list.push({ id: row.id, outcome: row.outcome, errorDetail: row.error_detail, attemptedAt: row.attempted_at });
      attemptsByJobId.set(row.reminder_job_id, list);
    }
  }

  const reminderJobs = (reminderJobRows ?? []).map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    sendAfter: job.send_after,
    cancelReason: job.cancel_reason,
    attempts: attemptsByJobId.get(job.id) ?? [],
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{client?.name ?? 'Unknown client'}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {estimate.currency_code}
            {revisionNumber !== null && ` · Revision ${revisionNumber}`}
          </p>
        </div>
        <EstimateStatusBadge status={estimate.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">Line items</h2>
        {lineItems.length > 0 ? (
          // overflow-x-auto wrapper -- without it, a long description column
          // forces the whole page to scroll horizontally on a narrow
          // viewport instead of just this table, the same fix
          // app/admin/page.tsx's own tables already use.
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pb-2 font-normal">Description</th>
                  <th className="pb-2 font-normal">Qty</th>
                  <th className="pb-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, idx) => (
                  <tr key={idx} className="border-t border-zinc-100">
                    <td className="py-2 text-zinc-900">{li.description}</td>
                    <td className="py-2 text-zinc-600">{li.quantity}</td>
                    <td className="py-2 text-right text-zinc-900">{li.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No line items.</p>
        )}

        {totals && (
          <dl className="mt-4 space-y-1 border-t border-zinc-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Subtotal</dt>
              <dd className="text-zinc-900">{totals.subtotal}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Discount</dt>
              <dd className="text-zinc-900">{totals.discount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Tax</dt>
              <dd className="text-zinc-900">{totals.tax}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-zinc-900">Total</dt>
              <dd className="text-zinc-900">{totals.total}</dd>
            </div>
          </dl>
        )}

        {(estimate.scope_notes || estimate.exclusions || estimate.terms) && (
          <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4 text-sm text-zinc-600">
            {estimate.scope_notes && <p><span className="font-medium text-zinc-900">Scope: </span>{estimate.scope_notes}</p>}
            {estimate.exclusions && <p><span className="font-medium text-zinc-900">Exclusions: </span>{estimate.exclusions}</p>}
            {estimate.terms && <p><span className="font-medium text-zinc-900">Terms: </span>{estimate.terms}</p>}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">Reminders</h2>
        {reminderJobs.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3">
            {reminderJobs.map((job) => (
              <li key={job.id} className="border-t border-zinc-100 pt-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-zinc-900">{reminderKindLabel(job.kind)}</p>
                    <p className="text-xs text-zinc-500">
                      {job.status === 'canceled'
                        ? `Canceled${job.cancelReason ? ` · ${job.cancelReason}` : ''}`
                        : `Scheduled for ${new Date(job.sendAfter).toLocaleString()}`}
                    </p>
                  </div>
                  <ReminderJobStatusBadge status={job.status} />
                </div>
                {job.attempts.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 pl-3">
                    {job.attempts.map((attempt) => (
                      <li key={attempt.id} className="text-xs text-zinc-600">
                        <span className={attempt.outcome === 'success' ? 'text-emerald-700' : 'text-red-700'}>
                          {attempt.outcome === 'success' ? 'Delivered' : 'Failed'}
                        </span>
                        {' · '}
                        {new Date(attempt.attemptedAt).toLocaleString()}
                        {attempt.errorDetail && ` · ${attempt.errorDetail}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No reminders scheduled.</p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-4">
        {estimate.status === 'draft' && <SendEstimateButton estimateId={estimate.id} />}
        {estimate.status !== 'draft' && (
          <>
            <a
              href={`/api/estimates/${estimate.id}/pdf`}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              Download PDF
            </a>
            <GenerateEstimateClientLinkButton estimateId={estimate.id} />
          </>
        )}
        <Link href="/estimates" className="text-sm text-zinc-600 hover:text-zinc-900">
          Back to estimates
        </Link>
      </div>
    </div>
  );
}
