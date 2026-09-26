import { NextRequest, NextResponse } from 'next/server';
import { resolveTargetToken, getBridgeRequestContext } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { generateEstimatePdf, type EstimatePdfLineItem } from '@/lib/pdf/estimate-pdf';
import { loadEstimateAcceptanceForPdf } from '@/lib/quotes-payments/estimate-acceptances';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase A -- token-authorized (not
// session-authorized) sibling of app/api/estimates/[id]/pdf/route.ts, for
// the "Download PDF" link on app/estimate/[token]/page.tsx. Every non-success
// resolveTargetToken() outcome returns the same generic 404 -- matching that
// function's own `{ error: 'link_unavailable' }` collapse one layer up, the
// same discipline the public page component uses for its own notFound().
// Reuses generateEstimatePdf() unmodified -- this route's only job is
// resolving the token, loading the same data the staff-facing route loads,
// and calling that same pure-rendering function.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveTargetToken(token, 'estimate', await getBridgeRequestContext());
  if ('error' in resolved) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: same "service-role client constructed only after token
  // validation, every query scoped by the validated orgId/targetId" contract
  // as app/estimate/[token]/page.tsx -- see
  // lib/supabase/service-client.ts's "Exception 2" comment.
  const supabase = createServiceClient();

  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('id, currency_code, expiry_date, scope_notes, exclusions, terms, current_revision_id, clients ( name )')
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (estimateError) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  if (!estimate || !estimate.current_revision_id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: revision, error: revisionError } = await supabase
    .from('estimate_revisions')
    .select('revision_number, sent_at, line_items, subtotal_cents, discount_total_cents, tax_total_cents, total_cents')
    .eq('id', estimate.current_revision_id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (revisionError || !revision) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
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

  const acceptance = await loadEstimateAcceptanceForPdf(supabase, orgId, estimate.current_revision_id);

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
    acceptance,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="estimate-${estimate.id}.pdf"`,
    },
  });
}
