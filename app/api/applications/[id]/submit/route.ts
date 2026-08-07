import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Terminal, contractor-driven "I filed this with the authority" marker.
// Deliberately has no corresponding lib/inngest/client.ts event -- unlike
// every other status transition in this file family, nothing in the system
// acts on "submitted" (no downstream worker, no generated artifact). It only
// exists so the applications list can stop surfacing a filed application as
// actionable. Same session-scoped, re-derive-from-DB discipline as
// confirm-review/route.ts.
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

  if (application.status !== 'documents_generated') {
    return NextResponse.json(
      { error: `Application status is "${application.status}", not "documents_generated" -- generate documents before marking submitted.` },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from('permit_applications')
    .update({ status: 'submitted' })
    .eq('id', applicationId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ applicationId, status: 'submitted' }, { status: 200 });
}
