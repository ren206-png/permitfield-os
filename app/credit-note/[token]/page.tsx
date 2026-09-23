import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { resolveTargetToken, getBridgeRequestContext } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { CreditNoteStatusBadge } from '@/components/credit-note-status-badge';

// Gate 4 (Quotes & Payments), Phase B. Route shape mirrors
// app/invoice/[token]/page.tsx exactly -- see that file's own header comment
// (and app/estimate/[token]/page.tsx's, which it in turn mirrors) for why
// the bearer token alone is this URL's only identifier. Unlike
// app/change-order/[token]/page.tsx, this gets the FULL artifact treatment
// per GATE_4_PHASE_B_FINDINGS.md §III Q5 -- a credit note has no acceptance
// step (nothing for the customer to act on here), so this is purely a
// read-only "here is a credit that was issued against your invoice" view
// plus a PDF download link, same shape as the invoice portal page minus its
// payment-history section (credit_notes has no line items or payments of
// its own -- see lib/quotes-payments/credit-notes.ts's header comment).
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function centsField(row: any, key: string): string {
  const value = row?.[key];
  if (value === null || value === undefined) return '—';
  return centsToDollarsString(dbValueToCents(value));
}

export default async function PublicCreditNotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Every non-success outcome collapses to notFound() -- same discipline as
  // every other client-portal page (see app/estimate/[token]/page.tsx's
  // header comment).
  const resolved = await resolveTargetToken(token, 'credit_note', await getBridgeRequestContext());
  if ('error' in resolved) {
    notFound();
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: see app/estimate/[token]/page.tsx's header comment --
  // this service-role client is constructed only after resolveTargetToken()
  // succeeded, and every query below is scoped by the orgId/targetId that
  // call returned.
  const supabase = createServiceClient();

  const { data: creditNote, error } = await supabase
    .from('credit_notes')
    .select(
      'id, status, currency_code, reason, credit_note_number, issued_at, voided_at, void_reason, issued_amount_cents, clients ( name ), invoices ( invoice_number )'
    )
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load credit note: ${error.message}`);
  }
  if (!creditNote) {
    notFound();
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(creditNote.clients) ? creditNote.clients[0] : creditNote.clients;
  const invoice = Array.isArray(creditNote.invoices) ? creditNote.invoices[0] : creditNote.invoices;
  const invoiceNumber = dbValueToCentsOrNull(invoice?.invoice_number ?? null);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-zinc-500">{taxProfile?.legal_name ?? 'Credit note'}</p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {creditNote.credit_note_number !== null ? `Credit note #${creditNote.credit_note_number}` : 'Credit note'} —{' '}
            {client?.name ?? 'you'}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {creditNote.currency_code}
            {invoiceNumber !== null && ` · Applied to invoice #${invoiceNumber}`}
          </p>
        </div>
        <CreditNoteStatusBadge status={creditNote.status} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {creditNote.status === 'draft' ? (
          <p className="text-sm text-zinc-500">This credit note is not yet available for viewing.</p>
        ) : (
          <>
            {creditNote.reason && (
              <>
                <h2 className="text-sm font-medium text-zinc-900">Reason</h2>
                <p className="mt-1 text-sm text-zinc-600">{creditNote.reason}</p>
              </>
            )}

            <dl className="mt-4 space-y-1 border-t border-zinc-100 pt-4 text-sm">
              <div className="flex justify-between font-medium">
                <dt className="text-zinc-900">Amount</dt>
                <dd className="text-zinc-900">{centsField(creditNote, 'issued_amount_cents')}</dd>
              </div>
            </dl>

            {creditNote.status === 'void' && creditNote.void_reason && (
              <p className="mt-4 border-t border-zinc-100 pt-4 text-sm text-red-700">
                <span className="font-medium">Void reason: </span>
                {creditNote.void_reason}
              </p>
            )}
          </>
        )}
      </div>

      {creditNote.status !== 'draft' && (
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <a
            href={`/api/public/credit-note/${token}/pdf`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Download PDF
          </a>
        </div>
      )}

      <p className="mt-10 text-sm text-zinc-500">{PRODUCT_NAME}</p>
    </div>
  );
}
