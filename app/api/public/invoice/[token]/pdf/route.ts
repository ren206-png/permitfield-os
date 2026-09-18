import { NextRequest, NextResponse } from 'next/server';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { generateInvoicePdf, type InvoicePdfLineItem } from '@/lib/pdf/invoice-pdf';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase A -- token-authorized sibling of
// app/api/invoices/[id]/pdf/route.ts, for the "Download PDF" link on
// app/invoice/[token]/page.tsx. Same generic-404-on-any-resolveTargetToken-
// failure discipline as app/api/public/estimate/[token]/pdf/route.ts -- see
// that file's own header comment. A voided invoice is still rendered (never
// blanked), per generateInvoicePdf()'s own doc comment -- unchanged here.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveTargetToken(token, 'invoice');
  if ('error' in resolved) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: same "service-role client constructed only after token
  // validation, every query scoped by the validated orgId/targetId" contract
  // as app/invoice/[token]/page.tsx -- see
  // lib/supabase/service-client.ts's "Exception 2" comment.
  const supabase = createServiceClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(
      'id, status, currency_code, due_date, issued_at, voided_at, void_reason, invoice_number, scope_notes, terms, issued_line_items, issued_subtotal_cents, issued_discount_total_cents, issued_tax_total_cents, issued_total_cents, document_hash, clients ( name )'
    )
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (invoiceError) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  if (!invoice || invoice.status === 'draft') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name, address_line1, address_line2, city, province_code, postal_code')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;
  const rawLineItems = Array.isArray(invoice.issued_line_items) ? invoice.issued_line_items : [];
  const lineItems: InvoicePdfLineItem[] = rawLineItems.map((li: Record<string, unknown>) => ({
    description: String(li.description ?? ''),
    quantity: String(li.quantity ?? ''),
    unitPriceCents: dbValueToCents(li.unit_price_cents as number),
    lineDiscountCents: dbValueToCents((li.line_discount_cents as number) ?? 0),
    gstHstCents: dbValueToCents((li.gst_hst_cents as number) ?? 0),
    pstCents: dbValueToCents((li.pst_cents as number) ?? 0),
    lineTotalCents: dbValueToCents(li.line_total_cents as number),
  }));

  const pdfBytes = await generateInvoicePdf({
    orgLegalName: taxProfile?.legal_name ?? 'Your organization',
    orgAddressLines: taxProfile
      ? [
          taxProfile.address_line1,
          taxProfile.address_line2,
          `${taxProfile.city}, ${taxProfile.province_code} ${taxProfile.postal_code}`,
        ].filter((line): line is string => Boolean(line))
      : [],
    clientName: client?.name ?? 'Client',
    invoiceId: invoice.id,
    invoiceNumber: dbValueToCents(invoice.invoice_number as number),
    status: invoice.status as 'issued' | 'void',
    issuedAt: invoice.issued_at ?? '',
    dueDate: invoice.due_date,
    voidedAt: invoice.voided_at,
    voidReason: invoice.void_reason,
    currencyCode: invoice.currency_code,
    scopeNotes: invoice.scope_notes,
    terms: invoice.terms,
    lineItems,
    subtotalCents: dbValueToCents(invoice.issued_subtotal_cents as number),
    discountTotalCents: dbValueToCents(invoice.issued_discount_total_cents as number),
    taxTotalCents: dbValueToCents(invoice.issued_tax_total_cents as number),
    totalCents: dbValueToCents(invoice.issued_total_cents as number),
    documentHash: invoice.document_hash,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoice.id}.pdf"`,
    },
  });
}
