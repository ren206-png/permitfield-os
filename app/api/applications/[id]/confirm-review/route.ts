import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';

// User-facing "I have reviewed every audit finding, proceed" endpoint
// (SS4.5's human-review gate for 'verified'-tier applications). Runs with
// the caller's own session via lib/supabase/server.ts, never
// lib/supabase/service-client.ts -- same discipline as
// app/api/documents/route.ts -- so a cross-tenant applicationId resolves to
// 404, not a leaked 403, and the eventual status update is still filtered
// by permit_applications_update's own is_org_member check even if this
// handler had a bug.
//
// This route only flips status 'ready_for_review' -> 'reviewed' and emits
// 'permit/application.review_confirmed'; it deliberately does not touch any
// audit_findings row itself -- confirming/dismissing individual findings is
// a separate (not-yet-built, Phase 5 UI) action against
// audit_findings_review_update. This route's whole job is checking that
// every finding has already gone through that action before the gate opens.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: applicationId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: application, error: applicationError } = await supabase
    .from('permit_applications')
    .select('id, status')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) {
    return NextResponse.json({ error: applicationError.message }, { status: 500 });
  }
  if (!application) {
    return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  }

  if (application.status !== 'ready_for_review') {
    return NextResponse.json(
      { error: `Application status is "${application.status}", not "ready_for_review" -- nothing to confirm.` },
      { status: 400 }
    );
  }

  // audits is append-only (SS3.10): the newest row for this application is
  // the current audit, never an overwritten column. There must be exactly
  // one relevant audit for a 'ready_for_review' application (that status is
  // only ever set by permit.audit after a successful audit run), but this
  // is still re-derived from the DB rather than assumed.
  const { data: latestAudit, error: auditError } = await supabase
    .from('audits')
    .select('id')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }
  if (!latestAudit) {
    return NextResponse.json(
      { error: 'No audit found for this application -- cannot confirm review of a nonexistent audit.' },
      { status: 400 }
    );
  }

  const { data: findings, error: findingsError } = await supabase
    .from('audit_findings')
    .select('id, review_status')
    .eq('audit_id', latestAudit.id);
  if (findingsError) {
    return NextResponse.json({ error: findingsError.message }, { status: 500 });
  }

  const unverified = (findings ?? []).filter((f) => f.review_status === 'unverified');
  if (unverified.length > 0) {
    return NextResponse.json(
      {
        error: `${unverified.length} audit finding(s) are still "unverified" -- every finding must be confirmed or dismissed before review can be completed.`,
        unverifiedFindingIds: unverified.map((f) => f.id),
      },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from('permit_applications')
    .update({ status: 'reviewed' })
    .eq('id', applicationId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await inngest.send({
    name: 'permit/application.review_confirmed',
    data: { applicationId } satisfies PermitEventPayloads['permit/application.review_confirmed'],
  });

  return NextResponse.json({ applicationId, status: 'reviewed' }, { status: 200 });
}
