import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { InvoiceStatusBadge } from '@/components/invoice-status-badge';
import { LockedFeature } from '@/components/locked-feature';

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/estimates/page.tsx's shape exactly, same double gate.
export default async function InvoicesPage() {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

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
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, status, currency_code, invoice_number, due_date, issued_total_cents, created_at, clients ( name )')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Invoices</h1>
        <div className="flex items-center gap-3">
          <a
            href={`/api/invoices/export?from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Export CSV
          </a>
          <Link
            href="/invoices/new"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            New invoice
          </Link>
        </div>
      </div>

      {invoices && invoices.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {invoices.map((invoice) => {
            const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;
            const totalCents = dbValueToCentsOrNull(invoice.issued_total_cents);
            return (
              <li key={invoice.id}>
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-zinc-900">
                        {invoice.invoice_number !== null ? `Invoice #${invoice.invoice_number}` : 'Draft'} —{' '}
                        {client?.name ?? 'Unknown client'}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-500">{invoice.currency_code}</p>
                      {invoice.due_date && <p className="mt-1 text-sm text-zinc-600">Due {invoice.due_date}</p>}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <InvoiceStatusBadge status={invoice.status} />
                      {totalCents !== null && (
                        <p className="text-sm font-medium text-zinc-900">{centsToDollarsString(totalCents)}</p>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No invoices yet.</p>
          <Link href="/invoices/new" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Create your first invoice
          </Link>
        </div>
      )}
    </div>
  );
}
