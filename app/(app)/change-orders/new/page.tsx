import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { LockedFeature } from '@/components/locked-feature';
import { NewChangeOrderForm } from './new-change-order-form';

// Gate 4 (Quotes & Payments), Phase B. Unlike
// app/(app)/invoices/new/page.tsx (a free client picker), a change order
// always targets one specific already-issued invoice
// (GATE_4_PHASE_B_FINDINGS.md §III Q1) -- so this page is reached only via
// a required ?invoiceId= query param (linked from
// app/(app)/invoices/[id]/page.tsx's "New change order" link), not from a
// standalone nav entry. A missing or invalid invoiceId, or an invoice not
// yet issued, 404s rather than rendering a broken form.
export default async function NewChangeOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { invoiceId } = await searchParams;
  if (!invoiceId) {
    notFound();
  }

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
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, status, invoice_number, clients ( name )')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load source invoice: ${error.message}`);
  }
  if (!invoice || invoice.status !== 'issued') {
    notFound();
  }

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">New change order</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Against invoice #{invoice.invoice_number} — {client?.name ?? 'Unknown client'}. Once accepted and issued, this
        produces a separate delta invoice; it never changes the original invoice&apos;s total.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewChangeOrderForm sourceInvoiceId={invoice.id} />
      </div>
      <div className="mt-4">
        <Link href={`/invoices/${invoice.id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
          Back to invoice
        </Link>
      </div>
    </div>
  );
}
