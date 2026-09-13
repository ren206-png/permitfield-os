import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { InvoiceStatusBadge } from '@/components/invoice-status-badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';

// Gate 4 (Quotes & Payments), Phase A. Route shape mirrors
// app/estimate/[token]/page.tsx exactly -- see that file's own header
// comment for why the bearer token alone, with no invoice id alongside it,
// is this URL's only identifier. No online payment on this page (Phase C,
// explicitly out of scope for this pass) -- this is a read-only "here is
// what you owe and how it was paid so far" view plus a PDF download link.
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Same generic-collapse discipline as app/estimate/[token]/page.tsx -- see
  // that file's comment on this exact call.
  const resolved = await resolveTargetToken(token, 'invoice');
  if ('error' in resolved) {
    notFound();
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: same "service-role client constructed only after token
  // validation, every query scoped by the validated orgId/targetId" contract
  // as app/estimate/[token]/page.tsx -- see
  // lib/supabase/service-client.ts's "Exception 2" comment.
  const supabase = createServiceClient();

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(
      'id, status, currency_code, invoice_number, due_date, issued_at, voided_at, void_reason, scope_notes, terms, issued_line_items, issued_subtotal_cents, issued_discount_total_cents, issued_tax_total_cents, issued_total_cents, clients ( name )'
    )
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load invoice: ${error.message}`);
  }
  // Should not happen -- resolveTargetToken() already re-checked this
  // moments ago -- but collapses to the same notFound() rather than a 500,
  // same reasoning as app/estimate/[token]/page.tsx's identical guard.
  if (!invoice) {
    notFound();
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;

  // Draft invoices are never issued a client-portal link (rejected at
  // generateInvoiceClientLinkAction) so this branch only exists as a
  // defensive fallback, not an expected path.
  const rawLineItems = Array.isArray(invoice.issued_line_items) ? invoice.issued_line_items : [];
  const lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
    description: String(li.description ?? ''),
    quantity: String(li.quantity ?? ''),
    total: centsField(li, 'line_total_cents'),
  }));
  const totals =
    lineItems.length > 0 || invoice.status !== 'draft'
      ? {
          subtotal: centsField(invoice, 'issued_subtotal_cents'),
          discount: centsField(invoice, 'issued_discount_total_cents'),
          tax: centsField(invoice, 'issued_tax_total_cents'),
          total: centsField(invoice, 'issued_total_cents'),
        }
      : null;

  // Payment history + outstanding balance -- same read-side aggregation
  // app/(app)/invoices/[id]/page.tsx already runs for the staff-facing
  // view (no shared helper exists for this yet -- see that page's own
  // header comment), scoped here by the token-validated orgId/targetId
  // rather than a session org.
  const payments: Array<{
    id: string;
    method: string;
    status: string;
    amountCents: bigint;
    receivedAt: string;
  }> = [];
  let outstandingCents: bigint | null = null;

  if (invoice.status !== 'draft') {
    const { data: allocationRows, error: allocationsError } = await supabase
      .from('payment_allocations')
      .select('amount_cents, payments ( id, method, status, received_at )')
      .eq('org_id', orgId)
      .eq('invoice_id', targetId);
    if (allocationsError) {
      throw new Error(`Failed to load payments: ${allocationsError.message}`);
    }

    let paidCents = 0n;
    for (const row of allocationRows ?? []) {
      const payment = Array.isArray(row.payments) ? row.payments[0] : row.payments;
      if (!payment) continue;
      const amountCents = dbValueToCents(row.amount_cents);
      if (payment.status === 'recorded') {
        paidCents += amountCents;
      }
      payments.push({
        id: payment.id,
        method: payment.method,
        status: payment.status,
        amountCents,
        receivedAt: payment.received_at,
      });
    }

    const issuedTotalCents = dbValueToCentsOrNull(invoice.issued_total_cents);
    if (issuedTotalCents !== null) {
      outstandingCents = issuedTotalCents - paidCents;
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-zinc-500">{taxProfile?.legal_name ?? 'Invoice'}</p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {invoice.invoice_number !== null ? `Invoice #${invoice.invoice_number}` : 'Invoice'} —{' '}
            {client?.name ?? 'you'}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {invoice.currency_code}
            {invoice.due_date && ` · Due ${invoice.due_date}`}
          </p>
        </div>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">Line items</h2>
        {lineItems.length > 0 ? (
          <table className="mt-3 w-full text-sm">
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
        ) : (
          <p className="mt-2 text-sm text-zinc-500">This invoice is not yet available for viewing.</p>
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
            {outstandingCents !== null && (
              <div className="flex justify-between border-t border-zinc-100 pt-1 font-medium">
                <dt className="text-zinc-900">Outstanding balance</dt>
                <dd className={outstandingCents > 0n ? 'text-amber-700' : 'text-emerald-700'}>
                  {centsToDollarsString(outstandingCents)}
                </dd>
              </div>
            )}
          </dl>
        )}

        {invoice.status === 'void' && invoice.void_reason && (
          <p className="mt-4 border-t border-zinc-100 pt-4 text-sm text-red-700">
            <span className="font-medium">Void reason: </span>
            {invoice.void_reason}
          </p>
        )}

        {(invoice.scope_notes || invoice.terms) && (
          <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4 text-sm text-zinc-600">
            {invoice.scope_notes && <p><span className="font-medium text-zinc-900">Scope: </span>{invoice.scope_notes}</p>}
            {invoice.terms && <p><span className="font-medium text-zinc-900">Terms: </span>{invoice.terms}</p>}
          </div>
        )}
      </div>

      {/*
        No payment-instructions field exists anywhere in this schema today --
        checked org_tax_profiles (20260806000044_org_tax_profiles.sql, full
        column list) and invoices (20260806000047_invoices.sql) directly; the
        closest analog it has is `org_tax_profiles.legal_name`/address, not a
        "how to pay us" text field. Rather than inventing one, this is
        surfaced as a plain, honest gap: an outstanding balance is shown
        above, but this page has no "how to pay it" copy to render alongside
        it. Flagged in this pass's own final report, not silently worked
        around.
      */}
      {outstandingCents !== null && outstandingCents > 0n && (
        <p className="mt-4 text-sm text-zinc-500">Contact {taxProfile?.legal_name ?? 'the sender'} for payment instructions.</p>
      )}

      {invoice.status !== 'draft' && (
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <a
            href={`/api/public/invoice/${token}/pdf`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Download PDF
          </a>
        </div>
      )}

      {payments.length > 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-zinc-900">Payment history</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 text-sm">
                <div>
                  <p className="text-zinc-900">
                    {centsToDollarsString(p.amountCents)} · {p.method === 'e_transfer' ? 'E-transfer' : 'Cheque'}
                  </p>
                  <p className="text-xs text-zinc-500">{p.receivedAt}</p>
                </div>
                <PaymentStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-10 text-sm text-zinc-500">{PRODUCT_NAME}</p>
    </div>
  );
}
