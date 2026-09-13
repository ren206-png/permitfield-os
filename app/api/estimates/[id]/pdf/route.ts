import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { generateEstimatePdf, type EstimatePdfLineItem } from '@/lib/pdf/estimate-pdf';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase A -- "Download PDF" endpoint for a sent
// estimate revision. Session-scoped client only (never
// lib/supabase/service-client.ts), same discipline
// app/api/applications/[id]/confirm-review/route.ts's header comment
// documents: a cross-tenant estimateId resolves to 404 via RLS, not a
// leaked 403. No requireOrgContext() here -- that helper calls
// next/navigation's redirect(), which is meant for the Server
// Component/Server Action render tree, not a Route Handler; org membership
// is instead derived with the same direct org_members query
// requireOrgContext() itself runs, mirrored inline.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isQuotesPaymentsEnabled()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { id: estimateId } = await params;
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

  if (!(await can(orgId, 'quotes.manage'))) {
    return NextResponse.json({ error: 'Your organization’s plan does not include Quotes & Payments.' }, { status: 403 });
  }

  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('id, currency_code, expiry_date, scope_notes, exclusions, terms, current_revision_id, clients ( name )')
    .eq('id', estimateId)
    .maybeSingle();
  if (estimateError) {
    return NextResponse.json({ error: estimateError.message }, { status: 500 });
  }
  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 });
  }
  if (!estimate.current_revision_id) {
    return NextResponse.json({ error: 'This estimate has not been sent yet -- no revision to render.' }, { status: 400 });
  }

  const { data: revision, error: revisionError } = await supabase
    .from('estimate_revisions')
    .select('revision_number, sent_at, line_items, subtotal_cents, discount_total_cents, tax_total_cents, total_cents')
    .eq('id', estimate.current_revision_id)
    .maybeSingle();
  if (revisionError) {
    return NextResponse.json({ error: revisionError.message }, { status: 500 });
  }
  if (!revision) {
    return NextResponse.json({ error: 'Estimate revision not found.' }, { status: 404 });
  }

  const { data: taxProfile } = await supabase
    .from('org_tax_profiles')
    .select('legal_name, address_line1, address_line2, city, province_code, postal_code')
    .eq('org_id', orgId)
    .maybeSingle();

  const client = Array.isArray(estimate.clients) ? estimate.clients[0] : estimate.clients;
  const rawLineItems = Array.isArray(revision.line_items) ? revision.line_items : [];
  const lineItems: EstimatePdfLineItem[] = rawLineItems.map((li: Record<string, unknown>) => ({
    description: String(li.description ?? ''),
    quantity: String(li.quantity ?? ''),
    unitPriceCents: dbValueToCents(li.unit_price_cents as number),
    lineDiscountCents: dbValueToCents((li.line_discount_cents as number) ?? 0),
    gstHstCents: dbValueToCents((li.gst_hst_cents as number) ?? 0),
    pstCents: dbValueToCents((li.pst_cents as number) ?? 0),
    lineTotalCents: dbValueToCents(li.line_total_cents as number),
  }));

  const pdfBytes = await generateEstimatePdf({
    orgLegalName: taxProfile?.legal_name ?? 'Your organization',
    orgAddressLines: taxProfile
      ? [
          taxProfile.address_line1,
          taxProfile.address_line2,
          `${taxProfile.city}, ${taxProfile.province_code} ${taxProfile.postal_code}`,
        ].filter((line): line is string => Boolean(line))
      : [],
    clientName: client?.name ?? 'Client',
    estimateId: estimate.id,
    revisionNumber: revision.revision_number,
    sentAt: revision.sent_at,
    expiryDate: estimate.expiry_date,
    currencyCode: estimate.currency_code,
    scopeNotes: estimate.scope_notes,
    exclusions: estimate.exclusions,
    terms: estimate.terms,
    lineItems,
    subtotalCents: dbValueToCents(revision.subtotal_cents),
    discountTotalCents: dbValueToCents(revision.discount_total_cents),
    taxTotalCents: dbValueToCents(revision.tax_total_cents),
    totalCents: dbValueToCents(revision.total_cents),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="estimate-${estimate.id}.pdf"`,
    },
  });
}
