import { NextRequest, NextResponse } from 'next/server';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { generateCreditNotePdf } from '@/lib/pdf/credit-note-pdf';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase B -- token-authorized sibling of
// app/api/public/invoice/[token]/pdf/route.ts, for the "Download PDF" link
// on app/credit-note/[token]/page.tsx. Same generic-404-on-any-
// resolveTargetToken-failure discipline as that file -- see its own header
// comment. A voided credit note is still rendered (never blanked), per
// generateCreditNotePdf()'s own doc comment -- unchanged here.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveTargetToken(token, 'credit_note');
  if ('error' in resolved) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: same "service-role client constructed only after token
  // validation, every query scoped by the validated orgId/targetId" contract
  // as app/credit-note/[token]/page.tsx -- see
  // lib/supabase/service-client.ts's "Exception 2" comment.
  const supabase = createServiceClient();

  const { data: creditNote, error: creditNoteError } = await supabase
    .from('credit_notes')
    .select(
      'id, status, currency_code, reason, credit_note_number, issued_at, voided_at, void_reason, issued_amount_cents, document_hash, clients ( name ), invoices ( invoice_number )'
    )
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (creditNoteError) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  if (!creditNote || creditNote.status === 'draft') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name, address_line1, address_line2, city, province_code, postal_code')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(creditNote.clients) ? creditNote.clients[0] : creditNote.clients;
  const invoice = Array.isArray(creditNote.invoices) ? creditNote.invoices[0] : creditNote.invoices;

  const pdfBytes = await generateCreditNotePdf({
    orgLegalName: taxProfile?.legal_name ?? 'Your organization',
    orgAddressLines: taxProfile
      ? [
          taxProfile.address_line1,
          taxProfile.address_line2,
          `${taxProfile.city}, ${taxProfile.province_code} ${taxProfile.postal_code}`,
        ].filter((line): line is string => Boolean(line))
      : [],
    clientName: client?.name ?? 'Client',
    creditNoteId: creditNote.id,
    creditNoteNumber: dbValueToCents(creditNote.credit_note_number as number),
    status: creditNote.status as 'issued' | 'void',
    issuedAt: creditNote.issued_at ?? '',
    voidedAt: creditNote.voided_at,
    voidReason: creditNote.void_reason,
    currencyCode: creditNote.currency_code,
    reason: creditNote.reason,
    invoiceNumber: invoice?.invoice_number === null || invoice?.invoice_number === undefined ? null : dbValueToCents(invoice.invoice_number as number),
    amountCents: dbValueToCentsOrNull(creditNote.issued_amount_cents) ?? 0n,
    documentHash: creditNote.document_hash,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="credit-note-${creditNote.id}.pdf"`,
    },
  });
}
