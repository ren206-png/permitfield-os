import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// User-facing "Confirm" / "Dismiss" action for a single audit finding
// (SS4.5). This is the action confirm-review/route.ts's header comment
// describes as "not yet built" -- every finding must pass through here
// before that route's all-findings-reviewed gate will open.
//
// Same discipline as app/api/documents/route.ts and confirm-review/route.ts:
// runs with the caller's own session (never service-client.ts), so a
// cross-tenant findingId/applicationId resolves to 404 via RLS
// (audit_findings_select), not a leaked 403.
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

  // Re-derive the finding -> audit -> application chain from the DB rather
  // than trusting that findingId (a route param) actually belongs to the
  // applicationId in the URL -- same "re-derive, don't trust the caller"
  // discipline as generate-pdf.ts's coverage_level re-check. RLS already
  // scopes the select to the caller's org; a findingId from another org's
  // audit resolves to "not found" here, never a cross-tenant leak.
  const { data: finding, error: findingError } = await supabase
    .from('audit_findings')
    .select('id, audit_id, audits ( application_id )')
    .eq('id', findingId)
    .maybeSingle();

  if (findingError) {
    return NextResponse.json({ error: findingError.message }, { status: 500 });
  }
  if (!finding) {
    return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  }

  const audit = Array.isArray(finding.audits) ? finding.audits[0] : finding.audits;
  if (!audit || audit.application_id !== applicationId) {
    return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  }

  // audits is append-only (SS3.10): re-running an audit creates a new row
  // rather than updating the old one, so a stale findingId from a superseded
  // audit run must not still be reviewable. The UI only ever surfaces
  // findings from the newest audit (applications/[id]/page.tsx's
  // `latestAudit` query), so this also rejects direct API calls against an
  // old run that the UI itself would never produce.
  const { data: latestAudit, error: latestAuditError } = await supabase
    .from('audits')
    .select('id')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestAuditError) {
    return NextResponse.json({ error: latestAuditError.message }, { status: 500 });
  }
  if (!latestAudit || latestAudit.id !== finding.audit_id) {
    return NextResponse.json(
      { error: 'This finding belongs to a superseded audit run and can no longer be reviewed.' },
      { status: 409 }
    );
  }

  const reviewStatus = action === 'confirm' ? 'confirmed' : 'dismissed';

  // audit_findings_restrict_update_trigger (migration 20260806000009) only
  // allows review_status/reviewed_by/reviewed_at to change on this table --
  // an attempt to touch any other column here would be rejected at the DB
  // layer even if this handler had a bug.
  const { data: updated, error: updateError } = await supabase
    .from('audit_findings')
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
