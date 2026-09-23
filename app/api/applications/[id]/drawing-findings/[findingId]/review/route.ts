import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Gate 5, sub-phase 5.4. Confirm/Dismiss for a single drawing_findings row --
// byte-for-byte the same shape as
// app/api/applications/[id]/findings/[findingId]/review/route.ts, adapted to
// drawing_findings' own join path (drawing_findings -> drawing_reviews,
// which carries application_id directly, unlike audit_findings ->
// audits -> permit_applications' two-hop chain -- 20260806000045's
// drawing_reviews table denormalizes application_id onto itself for exactly
// this kind of lookup).
//
// Same discipline as that sibling route: runs with the caller's own session
// (never lib/supabase/service-client.ts), so a cross-tenant findingId
// resolves to 404 via RLS (drawing_findings_select), not a leaked 403.
const REVIEW_ACTIONS = ['confirm', 'dismiss'] as const;
type ReviewAction = (typeof REVIEW_ACTIONS)[number];

function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) {
  const { id: applicationId, findingId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const action = body && typeof body === 'object' && 'action' in body ? (body as { action: unknown }).action : undefined;
  if (!isReviewAction(action)) {
    return NextResponse.json({ error: 'action must be "confirm" or "dismiss".' }, { status: 400 });
  }

  // Re-derive the finding -> review -> application chain from the DB rather
  // than trusting that findingId (a route param) actually belongs to the
  // applicationId in the URL -- same "re-derive, don't trust the caller"
  // discipline as the audit-findings sibling route. RLS already scopes the
  // select to the caller's org; a findingId from another org's review
  // resolves to "not found" here, never a cross-tenant leak.
  const { data: finding, error: findingError } = await supabase
    .from('drawing_findings')
    .select('id, drawing_review_id, drawing_reviews ( application_id, application_document_id )')
    .eq('id', findingId)
    .maybeSingle();

  if (findingError) {
    return NextResponse.json({ error: findingError.message }, { status: 500 });
  }
  if (!finding) {
    return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  }

  const review = Array.isArray(finding.drawing_reviews) ? finding.drawing_reviews[0] : finding.drawing_reviews;
  if (!review || review.application_id !== applicationId) {
    return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  }

  // drawing_reviews is append-only per document (idempotency: 'event.data.
  // applicationDocumentId' on the Inngest side collapses concurrent runs,
  // but does not prevent a genuinely later run once that idempotency window
  // has passed): the UI only ever surfaces findings from the newest review
  // for a given document (see page.tsx's own "latest review per document"
  // grouping), so a stale findingId from a superseded review must not still
  // be reviewable here either -- same "reject what the UI would never
  // itself produce" reasoning as the audit-findings sibling route's own
  // superseded-audit check.
  const { data: latestReview, error: latestReviewError } = await supabase
    .from('drawing_reviews')
    .select('id')
    .eq('application_document_id', review.application_document_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestReviewError) {
    return NextResponse.json({ error: latestReviewError.message }, { status: 500 });
  }
  if (!latestReview || latestReview.id !== finding.drawing_review_id) {
    return NextResponse.json(
      { error: 'This finding belongs to a superseded drawing review and can no longer be reviewed.' },
      { status: 409 }
    );
  }

  const reviewStatus = action === 'confirm' ? 'confirmed' : 'dismissed';

  // drawing_findings_restrict_update_trigger (migration 20260806000045)
  // only allows review_status/reviewed_by/reviewed_at to change on this
  // table -- an attempt to touch any other column here would be rejected at
  // the DB layer even if this handler had a bug.
  const { data: updated, error: updateError } = await supabase
    .from('drawing_findings')
    .update({ review_status: reviewStatus, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', findingId)
    .select('id, review_status')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update finding.' }, { status: 500 });
  }

  return NextResponse.json({ findingId: updated.id, reviewStatus: updated.review_status }, { status: 200 });
}
