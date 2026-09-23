import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isDrawingReviewEnabled } from '@/lib/flags';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';

// Gate 5, sub-phase 5.4 (GATE_5_FINDINGS.md §K) -- the real trigger call
// site sub-phase 5.2's own header comment named as deferred ("wiring a real
// trigger call site... is deferred to 5.4"). Everything downstream of
// sending this event (lib/inngest/functions/drawing-review.ts) already
// existed and was already end-to-end-testable; this route's only job is to
// be the first thing that actually calls it, from a real staff action
// rather than a test fixture.
//
// Same discipline as app/api/documents/route.ts and the audit-findings
// review route: runs with the caller's own session (never
// lib/supabase/service-client.ts), so a cross-tenant applicationId/documentId
// resolves to 404 via RLS (application_documents_select), not a leaked 403 --
// and the applicationId route param is independently cross-checked against
// the document's own application_id rather than trusted, same "re-derive,
// don't trust the caller" discipline as generate-pdf.ts's coverage_level
// re-check.
//
// doc_kind === 'blueprint' is enforced HERE, in application code, because
// nothing in the schema can: application_documents has no CHECK tying
// doc_kind to this route (Postgres CHECK constraints can't reference this
// kind of cross-cutting business rule), and 20260806000045's own header
// comment named this route as the intended enforcement point ("Gate 5.2's
// service layer is the enforcement point"). Rejecting a non-blueprint
// document here, before the event is even sent, means a staff member never
// gets a "review started" response for a document that
// lib/inngest/functions/drawing-review.ts would attempt against anyway --
// that function has no doc_kind check of its own, by the same
// division-of-labor reasoning.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const { id: applicationId, documentId } = await params;
  void request;

  if (!isDrawingReviewEnabled()) {
    return NextResponse.json(
      { error: 'Drawing review is currently off (PERMITFIELD_FF_DRAWING_REVIEW).' },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: document, error: documentError } = await supabase
    .from('application_documents')
    .select('id, application_id, doc_kind')
    .eq('id', documentId)
    .maybeSingle();

  if (documentError) {
    return NextResponse.json({ error: documentError.message }, { status: 500 });
  }
  if (!document || document.application_id !== applicationId) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }
  if (document.doc_kind !== 'blueprint') {
    return NextResponse.json({ error: 'Only blueprint documents can be sent for drawing review.' }, { status: 400 });
  }

  // Idempotent on the Inngest side (idempotency: 'event.data.applicationDocumentId',
  // drawing-review.ts's own header) -- a repeat click against a document
  // that already has a review in flight or completed is a safe no-op, not
  // a duplicate row. This route does not attempt to duplicate that check
  // itself.
  await inngest.send({
    name: 'permit/application.drawing_review_ready',
    data: { applicationId, applicationDocumentId: documentId } satisfies PermitEventPayloads['permit/application.drawing_review_ready'],
  });

  return NextResponse.json({ applicationId, applicationDocumentId: documentId, triggered: true }, { status: 202 });
}
