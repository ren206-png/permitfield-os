import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminEmails } from '@/lib/auth/admin';
import { isAdminPanelEnabled, isSourceRegistryEnabled } from '@/lib/flags';
import { prepareUploadedSource } from '@/lib/sources/upload';
import { createClient } from '@/lib/supabase/server';

// Admin upload of an official source copy (migration 20260806000100), for
// sources the automated check cannot fetch. A route handler rather than a
// Server Action because actions cap request bodies at 1 MB.
//
// Same gates as the /admin/sources actions: both flags, the ADMIN_EMAILS
// allowlist, and the write runs through the admin's OWN session so
// record_source_upload's is_platform_admin() check applies independently
// and the uploader recorded is auth.uid(). Anyone else gets a plain 404.
// The Origin check stops another site from posting with the admin's cookies.

function notFoundResponse() {
  return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  if (!isAdminPanelEnabled() || !isSourceRegistryEnabled()) return notFoundResponse();
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email || !adminEmails().includes(email)) return notFoundResponse();

  const { sourceId } = await params;
  if (!z.guid().safeParse(sourceId).success) return notFoundResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });

  const prepared = await prepareUploadedSource(Buffer.from(await file.arrayBuffer()), file.type, file.name);
  if (!prepared.ok) return NextResponse.json({ error: prepared.message }, { status: prepared.status });

  const { data, error } = await supabase.rpc('record_source_upload', {
    p_source_id: sourceId,
    p_file_name: prepared.fileName,
    p_content_type: prepared.contentType,
    p_byte_length: prepared.byteLength,
    p_capture: prepared.capture,
  });
  if (error) {
    if (error.code === '42501') {
      return NextResponse.json({ error: 'The database does not recognise your account as a platform admin, so nothing was saved.' }, { status: 403 });
    }
    if (error.code === 'P0002') return notFoundResponse();
    return NextResponse.json({ error: `Not saved: ${error.message}` }, { status: 500 });
  }
  const row = (data as { check_run_id: string; outcome: string; capture_id: string | null }[])[0];
  return NextResponse.json({ outcome: row.outcome, captureId: row.capture_id });
}
