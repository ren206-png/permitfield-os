import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToDollarsString, multiplyCentsByFraction, parseDecimalQuantity } from '@/lib/money/cents';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';
import { ChangeOrderStatusBadge } from '@/components/change-order-status-badge';
import { LockedFeature } from '@/components/locked-feature';
import { SendChangeOrderButton } from './send-change-order-button';
import { IssueChangeOrderButton } from './issue-change-order-button';
import { VoidChangeOrderForm } from './void-change-order-form';
import { GenerateChangeOrderClientLinkButton } from './generate-client-link-button';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

// Gate 4 (Quotes & Payments), Phase B. Mirrors
// app/(app)/estimates/[id]/page.tsx's shape: mutable draft line items while
// status = 'draft', immutable sent_line_items jsonb snapshot once sent (or
// later) -- never both. Lifecycle buttons follow the change_order_status
// enum exactly: draft -> "Send for acceptance"; pending_acceptance -> link
// only (waiting on the customer); accepted -> "Issue change order"; issued
// -> link to the resulting invoice; void is terminal. A client link may be
// generated any time after draft, matching the invoice/estimate detail
// pages' own "(re)generate any time after sending" posture.
export default async function ChangeOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { id } = await params;
  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'invoices.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Change orders unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const supabase = await createClient();

  const { data: changeOrder, error } = await supabase
    .from('change_orders')
    .select(
      'id, status, currency_code, title, description, source_invoice_id, resulting_invoice_id, voided_at, void_reason, created_at, clients ( name ), invoices ( invoice_number )'
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load change order: ${error.message}`);
  }
  if (!changeOrder) {
    notFound();
  }

  const client = Array.isArray(changeOrder.clients) ? changeOrder.clients[0] : changeOrder.clients;
  const sourceInvoice = Array.isArray(changeOrder.invoices) ? changeOrder.invoices[0] : changeOrder.invoices;

  let lineItems: Array<{ description: string; quantity: string; total: string }> = [];
  let totals: { subtotal: string; discount: string; tax: string; total: string } | null = null;

  if (changeOrder.status === 'draft') {
    const { data: draftLineItems, error: lineItemsError } = await supabase
      .from('change_order_line_items')
      .select('description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
      .eq('org_id', orgId)
      .eq('change_order_id', id)
      .order('position', { ascending: true });
    if (lineItemsError) {
      throw new Error(`Failed to load line items: ${lineItemsError.message}`);
    }
    // Draft-stage display total only (pre-discount, pre-tax) -- same
    // float-free multiplyCentsByFraction()/parseDecimalQuantity() discipline
    // as the estimate/invoice detail pages.
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
    const { data: fullChangeOrder, error: fullError } = await supabase
      .from('change_orders')
      .select('sent_line_items, sent_subtotal_cents, sent_discount_total_cents, sent_tax_total_cents, sent_total_cents')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (fullError) {
      throw new Error(`Failed to load sent change order snapshot: ${fullError.message}`);
    }
    if (fullChangeOrder) {
      const rawLineItems = Array.isArray(fullChangeOrder.sent_line_items) ? fullChangeOrder.sent_line_items : [];
      lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
        description: String(li.description ?? ''),
        quantity: String(li.quantity ?? ''),
        total: centsField(li, 'line_total_cents'),
      }));
      totals = {
        subtotal: centsField(fullChangeOrder, 'sent_subtotal_cents'),
        discount: centsField(fullChangeOrder, 'sent_discount_total_cents'),
        tax: centsField(fullChangeOrder, 'sent_tax_total_cents'),
        total: centsField(fullChangeOrder, 'sent_total_cents'),
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {changeOrder.title} — {client?.name ?? 'Unknown client'}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {changeOrder.currency_code}
            {sourceInvoice && (
              <>
                {' · Against '}
                <Link href={`/invoices/${changeOrder.source_invoice_id}`} className="underline">
                  Invoice #{sourceInvoice.invoice_number}
                </Link>
              </>
            )}
          </p>
        </div>
        <ChangeOrderStatusBadge status={changeOrder.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {changeOrder.description && <p className="text-sm text-zinc-600">{changeOrder.description}</p>}

        <h2 className="mt-4 text-sm font-medium text-zinc-900">Delta line items</h2>
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

        {changeOrder.status === 'void' && changeOrder.void_reason && (
          <p className="mt-4 border-t border-zinc-100 pt-4 text-sm text-red-700">
            <span className="font-medium">Void reason: </span>
            {changeOrder.void_reason}
          </p>
        )}

        {changeOrder.status === 'issued' && changeOrder.resulting_invoice_id && (
          <p className="mt-4 border-t border-zinc-100 pt-4 text-sm text-emerald-700">
            Issued as{' '}
            <Link href={`/invoices/${changeOrder.resulting_invoice_id}`} className="underline">
              a separate invoice
            </Link>
            . The original invoice&apos;s total was never changed.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-4">
        {changeOrder.status === 'draft' && (
          <>
            <SendChangeOrderButton changeOrderId={changeOrder.id} />
            <VoidChangeOrderForm changeOrderId={changeOrder.id} />
          </>
        )}
        {changeOrder.status === 'pending_acceptance' && (
          <>
            <GenerateChangeOrderClientLinkButton changeOrderId={changeOrder.id} />
            <VoidChangeOrderForm changeOrderId={changeOrder.id} />
          </>
        )}
        {changeOrder.status === 'accepted' && (
          <>
            <IssueChangeOrderButton changeOrderId={changeOrder.id} />
            <GenerateChangeOrderClientLinkButton changeOrderId={changeOrder.id} />
            <VoidChangeOrderForm changeOrderId={changeOrder.id} />
          </>
        )}
        {changeOrder.status === 'issued' && <GenerateChangeOrderClientLinkButton changeOrderId={changeOrder.id} />}
        <Link href={`/invoices/${changeOrder.source_invoice_id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
          Back to invoice
        </Link>
      </div>
    </div>
  );
}
