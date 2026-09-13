import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { generateInvoicePdf, type InvoicePdfLineItem } from '@/lib/pdf/invoice-pdf';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase A -- "Download PDF" endpoint for an
// issued (or voided-after-issuance) invoice. Same session-scoped-client,
// RLS-is-the-tenant-boundary, inline-org-lookup discipline as
// app/api/estimates/[id]/pdf/route.ts -- see that file's header comment.
// A voided invoice is still rendered (never blanked), per
// generateInvoicePdf()'s own doc comment.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isQuotesPaymentsEnabled()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { id: invoiceId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: 'No organization membership found.' }, { status: 403 });
  }
  const orgId = membership.org_id;

  if (!(await can(orgId, 'invoices.manage'))) {
    return NextResponse.json({ error: 'Your organization’s plan does not include Quotes & Payments.' }, { status: 403 });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(
      'id, status, currency_code, due_date, issued_at, voided_at, void_reason, invoice_number, scope_notes, terms, issued_line_items, issued_subtotal_cents, issued_discount_total_cents, issued_tax_total_cents, issued_total_cents, document_hash, clients ( name )'
    )
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) {
    return NextResponse.json({ error: invoiceError.message }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  if (invoice.status === 'draft') {
    return NextResponse.json({ error: 'This invoice has not been issued yet -- no issued snapshot to render.' }, { status: 400 });
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
