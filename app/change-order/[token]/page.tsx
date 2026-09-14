import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';
import { ChangeOrderStatusBadge } from '@/components/change-order-status-badge';
import { AcceptChangeOrderForm } from './accept-change-order-form';

// Gate 4 (Quotes & Payments), Phase B. Route shape: `/change-order/[token]`,
// mirroring `/estimate/[token]`/`/invoice/[token]` exactly -- the bearer
// token is the URL's only identifier (see app/estimate/[token]/page.tsx's
// own header comment for the full reasoning, not re-derived here).
//
// Deliberately LIGHTWEIGHT compared to the estimate/invoice portal pages,
// per GATE_4_PHASE_B_FINDINGS.md §III Q5's resolution: no PDF download, no
// full itemized artifact treatment -- just enough to confirm what's being
// asked for and let the customer accept it. Forced dynamic for the same
// per-request-token-resolution reason every other client-portal page in
// this codebase states.
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

export default async function PublicChangeOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Every non-success outcome collapses to notFound() -- same discipline as
  // every other client-portal page (see app/estimate/[token]/page.tsx's
  // header comment).
  const resolved = await resolveTargetToken(token, 'change_order');
  if ('error' in resolved) {
    notFound();
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: see app/estimate/[token]/page.tsx's header comment --
  // this service-role client is constructed only after resolveTargetToken()
  // succeeded, and every query below is scoped by the orgId/targetId that
  // call returned.
  const supabase = createServiceClient();

  const { data: changeOrder, error } = await supabase
    .from('change_orders')
    .select('id, status, currency_code, title, description, sent_line_items, sent_subtotal_cents, sent_discount_total_cents, sent_tax_total_cents, sent_total_cents, clients ( name )')
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load change order: ${error.message}`);
  }
  if (!changeOrder) {
    notFound();
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(changeOrder.clients) ? changeOrder.clients[0] : changeOrder.clients;

  const rawLineItems = Array.isArray(changeOrder.sent_line_items) ? changeOrder.sent_line_items : [];
  const lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
    description: String(li.description ?? ''),
    quantity: String(li.quantity ?? ''),
    total: centsField(li, 'line_total_cents'),
  }));

  const hasTotals = changeOrder.sent_total_cents !== null && changeOrder.sent_total_cents !== undefined;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-zinc-500">{taxProfile?.legal_name ?? 'Change order'}</p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Change order for {client?.name ?? 'you'}</h1>
          <p className="mt-1 text-sm text-zinc-600">{changeOrder.title}</p>
        </div>
        <ChangeOrderStatusBadge status={changeOrder.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {changeOrder.description && <p className="text-sm text-zinc-600">{changeOrder.description}</p>}

        <h2 className="mt-4 text-sm font-medium text-zinc-900">Additional line items</h2>
        {lineItems.length > 0 ? (
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
          <p className="mt-2 text-sm text-zinc-500">This change order is not yet available for viewing.</p>
        )}

        {hasTotals && (
          <dl className="mt-4 space-y-1 border-t border-zinc-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Subtotal</dt>
              <dd className="text-zinc-900">{centsField(changeOrder, 'sent_subtotal_cents')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Discount</dt>
              <dd className="text-zinc-900">{centsField(changeOrder, 'sent_discount_total_cents')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Tax</dt>
              <dd className="text-zinc-900">{centsField(changeOrder, 'sent_tax_total_cents')}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-zinc-900">Additional total</dt>
              <dd className="text-zinc-900">{centsField(changeOrder, 'sent_total_cents')}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {changeOrder.status === 'pending_acceptance' && <AcceptChangeOrderForm token={token} />}
        {(changeOrder.status === 'accepted' || changeOrder.status === 'issued') && (
          <p className="text-sm font-medium text-emerald-700">This change order has already been accepted.</p>
        )}
        {changeOrder.status === 'void' && (
          <p className="text-sm font-medium text-zinc-600">This change order is no longer open for acceptance.</p>
        )}
        {changeOrder.status === 'draft' && (
          <p className="text-sm text-zinc-500">This change order is not yet available for viewing.</p>
        )}
      </div>

      <p className="mt-10 text-sm text-zinc-500">{PRODUCT_NAME}</p>
    </div>
  );
}
