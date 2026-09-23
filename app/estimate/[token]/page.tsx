import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { resolveTargetToken, getBridgeRequestContext } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';
import { EstimateStatusBadge } from '@/components/estimate-status-badge';
import { AcceptEstimateForm } from './accept-estimate-form';

// Gate 4 (Quotes & Payments), Phase A. Route shape: `/estimate/[token]`
// (singular, un-prefixed) -- the bearer token itself, not an estimate id, is
// the URL's only identifier, matching every other client-portal-facing URL
// this bridge issues (see lib/bridge/client-portal.ts's own rawToken
// contract: the token IS the credential, an org/estimate id in the URL
// would add nothing an attacker couldn't already see and would invite
// building a second, redundant authorization check around it). Forced
// dynamic for the same reason app/permits/ca/[region]/[city]/page.tsx states
// its own force-dynamic: this page's content depends on a live per-request
// lookup (a token resolves to different, or no, content over its lifetime),
// so it must never be frozen at build time under either data-access
// strategy.
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

export default async function PublicEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Every non-success outcome from resolveTargetToken -- flag off, token not
  // found/expired/revoked/superseded, wrong target_kind, or the estimate row
  // itself no longer existing in that org -- collapses to the same
  // notFound() here. This mirrors resolveTargetToken()'s own generic
  // `{ error: 'link_unavailable' }` collapse (see that function's header
  // comment) one layer up: a 404 is this route's version of the identical
  // "link_unavailable" response every denial reason produces, so a visitor
  // can never distinguish "wrong token" from "revoked" from "this was never
  // an estimate link" from the page they're shown.
  const resolved = await resolveTargetToken(token, 'estimate', await getBridgeRequestContext());
  if ('error' in resolved) {
    notFound();
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: this service-role client is constructed only after the
  // resolveTargetToken() call above succeeded, and every query below is
  // explicitly scoped with the orgId/targetId THAT CALL returned -- never
  // with any other request-derived value. See
  // lib/supabase/service-client.ts's "Exception 2" comment for the full
  // reasoning this route relies on.
  const supabase = createServiceClient();

  const { data: estimate, error } = await supabase
    .from('estimates')
    .select(
      'id, status, currency_code, expiry_date, scope_notes, exclusions, terms, current_revision_id, clients ( name )'
    )
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load estimate: ${error.message}`);
  }
  // Should not happen -- resolveTargetToken() already ran targetExistsInOrg()
  // moments ago -- but a delete race between that check and this read is not
  // impossible, so this collapses to the same notFound() as every other
  // denial rather than a 500.
  if (!estimate) {
    notFound();
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(estimate.clients) ? estimate.clients[0] : estimate.clients;

  let lineItems: Array<{ description: string; quantity: string; total: string }> = [];
  let totals: { subtotal: string; discount: string; tax: string; total: string } | null = null;
  let revisionNumber: number | null = null;
  let sentAt: string | null = null;

  if (estimate.current_revision_id) {
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
      sentAt = revision.sent_at;
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

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-zinc-500">{taxProfile?.legal_name ?? 'Estimate'}</p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Estimate for {client?.name ?? 'you'}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {estimate.currency_code}
            {revisionNumber !== null && ` · Revision ${revisionNumber}`}
            {sentAt && ` · Sent ${new Date(sentAt).toLocaleDateString()}`}
            {estimate.expiry_date && ` · Expires ${estimate.expiry_date}`}
          </p>
        </div>
        <EstimateStatusBadge status={estimate.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">Line items</h2>
        {lineItems.length > 0 ? (
          // See app/(app)/estimates/[id]/page.tsx's matching comment for
          // why this table is wrapped in overflow-x-auto.
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
        ) : estimate.status === 'draft' ? (
          // Distinguished from the generic message below -- a draft with
          // no line items yet is an expected, ordinary state (staff hasn't
          // sent it), not a data anomaly, so it gets its own copy rather
          // than sharing the "not yet available" wording used for every
          // other reason this table could be empty.
          <p className="mt-2 text-sm text-zinc-500">This estimate is still being prepared.</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">This estimate is not yet available for viewing.</p>
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

      {totals && (
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <a
            href={`/api/public/estimate/${token}/pdf`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Download PDF
          </a>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {estimate.status === 'sent' && <AcceptEstimateForm token={token} />}
        {estimate.status === 'accepted' && (
          <p className="text-sm font-medium text-emerald-700">This estimate has already been accepted.</p>
        )}
        {(estimate.status === 'declined' || estimate.status === 'expired' || estimate.status === 'void') && (
          <p className="text-sm font-medium text-zinc-600">This estimate is no longer open for acceptance.</p>
        )}
        {estimate.status === 'draft' && (
          <p className="text-sm text-zinc-500">This estimate is not yet available for viewing.</p>
        )}
      </div>

      <p className="mt-10 text-sm text-zinc-500">{PRODUCT_NAME}</p>
    </div>
  );
}
