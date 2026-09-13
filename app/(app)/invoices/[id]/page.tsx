import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToDollarsString, multiplyCentsByFraction, parseDecimalQuantity } from '@/lib/money/cents';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { InvoiceStatusBadge } from '@/components/invoice-status-badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { LockedFeature } from '@/components/locked-feature';
import { IssueInvoiceButton } from './issue-invoice-button';
import { VoidInvoiceForm } from './void-invoice-form';
import { RecordPaymentForm } from './record-payment-form';
import { ReversePaymentButton } from './reverse-payment-button';
import { GenerateInvoiceClientLinkButton } from './generate-client-link-button';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/estimates/[id]/page.tsx's shape (mutable draft line items while
// status = 'draft', immutable issued_line_items jsonb snapshot once issued
// or void -- a voided invoice's snapshot is still rendered, never blanked,
// per generateInvoicePdf()'s own doc comment), plus this feature's own
// additions: an outstanding-balance figure and inline payment history,
// computed from payment_allocations joined to payments -- both loaded here
// directly rather than via a shared helper, since no "invoice balance"
// concept exists yet in lib/quotes-payments/ (Phase A's service layer only
// covers the invoice and payment write paths themselves, not this read-side
// aggregation).
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { id } = await params;
  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'invoices.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Invoices unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(
      'id, status, client_id, currency_code, invoice_number, due_date, issued_at, voided_at, void_reason, scope_notes, terms, issued_total_cents, created_at, clients ( name )'
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load invoice: ${error.message}`);
  }
  if (!invoice) {
    notFound();
  }

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;

  let lineItems: Array<{ description: string; quantity: string; total: string }> = [];
  let totals: { subtotal: string; discount: string; tax: string; total: string } | null = null;

  if (invoice.status === 'draft') {
    const { data: draftLineItems, error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .select('description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
      .eq('org_id', orgId)
      .eq('invoice_id', id)
      .order('position', { ascending: true });
    if (lineItemsError) {
      throw new Error(`Failed to load line items: ${lineItemsError.message}`);
    }
    // Draft-stage display total only (pre-discount, pre-tax) -- same
    // multiplyCentsByFraction()/parseDecimalQuantity() float-free
    // discipline as app/(app)/estimates/[id]/page.tsx.
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
  } else {
    const { data: fullInvoice, error: fullError } = await supabase
      .from('invoices')
      .select('issued_line_items, issued_subtotal_cents, issued_discount_total_cents, issued_tax_total_cents, issued_total_cents')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (fullError) {
      throw new Error(`Failed to load issued invoice snapshot: ${fullError.message}`);
    }
    if (fullInvoice) {
      const rawLineItems = Array.isArray(fullInvoice.issued_line_items) ? fullInvoice.issued_line_items : [];
      lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
        description: String(li.description ?? ''),
        quantity: String(li.quantity ?? ''),
        total: centsField(li, 'line_total_cents'),
      }));
      totals = {
        subtotal: centsField(fullInvoice, 'issued_subtotal_cents'),
        discount: centsField(fullInvoice, 'issued_discount_total_cents'),
        tax: centsField(fullInvoice, 'issued_tax_total_cents'),
        total: centsField(fullInvoice, 'issued_total_cents'),
      };
    }
  }

  // Payment history + outstanding balance -- only meaningful once issued
  // (a draft has no total to be paid against yet).
  const payments: Array<{
    id: string;
    method: string;
    status: string;
    amountCents: bigint;
    referenceNote: string | null;
    receivedAt: string;
  }> = [];
  let outstandingCents: bigint | null = null;

  if (invoice.status !== 'draft') {
    const { data: allocationRows, error: allocationsError } = await supabase
      .from('payment_allocations')
      .select('amount_cents, payments ( id, method, status, reference_note, received_at )')
      .eq('org_id', orgId)
      .eq('invoice_id', id);
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
        referenceNote: payment.reference_note ?? null,
        receivedAt: payment.received_at,
      });
    }

    const issuedTotalCents = dbValueToCentsOrNull(invoice.issued_total_cents);
    if (issuedTotalCents !== null) {
      outstandingCents = issuedTotalCents - paidCents;
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {invoice.invoice_number !== null ? `Invoice #${invoice.invoice_number}` : 'Draft'} —{' '}
            {client?.name ?? 'Unknown client'}
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

      {invoice.status !== 'draft' && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-900">Payments</h2>
            {invoice.status === 'issued' && <RecordPaymentForm invoiceId={invoice.id} clientId={invoice.client_id} />}
          </div>
          {payments.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 text-sm">
                  <div>
                    <p className="text-zinc-900">
                      {centsToDollarsString(p.amountCents)} · {p.method === 'e_transfer' ? 'E-transfer' : 'Cheque'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {p.receivedAt}
                      {p.referenceNote ? ` · ${p.referenceNote}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaymentStatusBadge status={p.status} />
                    {p.status === 'recorded' && <ReversePaymentButton paymentId={p.id} invoiceId={invoice.id} />}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No payments recorded yet.</p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {invoice.status === 'draft' && <IssueInvoiceButton invoiceId={invoice.id} />}
        {invoice.status === 'issued' && (
          <>
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              Download PDF
            </a>
            <GenerateInvoiceClientLinkButton invoiceId={invoice.id} />
            <VoidInvoiceForm invoiceId={invoice.id} />
          </>
        )}
        {invoice.status === 'void' && (
          <>
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              Download PDF
            </a>
            <GenerateInvoiceClientLinkButton invoiceId={invoice.id} />
          </>
        )}
        <Link href="/invoices" className="text-sm text-zinc-600 hover:text-zinc-900">
          Back to invoices
        </Link>
      </div>
    </div>
  );
}
