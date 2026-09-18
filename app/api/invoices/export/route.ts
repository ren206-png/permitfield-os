import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { exportInvoicesCsv } from '@/lib/quotes-payments/csv-export';

// Gate 4 (Quotes & Payments), Phase A -- CSV export endpoint wrapping
// lib/quotes-payments/csv-export.ts's exportInvoicesCsv(). `from`/`to`
// query params are required, 'YYYY-MM-DD' each, matching that module's own
// InvoiceCsvExportParams contract. Same inline org-lookup /
// session-scoped-client discipline as the PDF download routes (see
// app/api/estimates/[id]/pdf/route.ts's header comment) -- exportInvoicesCsv
// itself is org-scoped via an explicit .eq('org_id', ...) inside the query,
// not RLS alone, so the orgId derived here is load-bearing, not redundant.
export async function GET(request: NextRequest) {
  if (!isQuotesPaymentsEnabled()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

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

  const fromDate = request.nextUrl.searchParams.get('from');
  const toDate = request.nextUrl.searchParams.get('to');
  if (!fromDate || !toDate) {
    return NextResponse.json({ error: 'Both "from" and "to" query params (YYYY-MM-DD) are required.' }, { status: 400 });
  }

  let csv: string;
  try {
    csv = await exportInvoicesCsv(supabase, { orgId, fromDate, toDate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to export invoices.' }, { status: 500 });
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="invoices-${fromDate}-to-${toDate}.csv"`,
    },
  });
}
