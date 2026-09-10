import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import {
  ALLOWED_MIME_TYPES,
  MAX_APPLICATION_TOTAL_BYTES,
  MAX_FILE_SIZE_BYTES,
  UPLOADS_BUCKET,
  buildStoragePath,
  computeSha256,
  isAllowedMimeType,
} from '@/lib/storage/documents';

// User-facing upload endpoint (SS4.1). Runs with the caller's own session
// via lib/supabase/server.ts, so every read/write below is filtered by RLS
// -- an applicationId belonging to another org resolves to "not found," not
// a leaked 403, and an insert into another org's application is rejected by
// application_documents_insert (20260806000006) even if this handler had a
// bug. Never import lib/supabase/service-client.ts here.
const DOC_KINDS = ['blueprint', 'spec_sheet', 'scope_of_work', 'other'] as const;
type DocKind = (typeof DOC_KINDS)[number];

function isDocKind(value: string): value is DocKind {
  return (DOC_KINDS as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 });
  }

  const applicationId = formData.get('applicationId');
  if (typeof applicationId !== 'string' || applicationId.length === 0) {
    return NextResponse.json({ error: 'applicationId is required.' }, { status: 400 });
  }

  const files = formData.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'At least one file is required (field name "file").' },
      { status: 400 }
    );
  }

  const docKindRaw = formData.get('docKind');
  const docKind: DocKind = typeof docKindRaw === 'string' && isDocKind(docKindRaw) ? docKindRaw : 'other';

  // Until Phase 5's wizard exists to drive a real "I'm done uploading" step,
  // this flag is how a caller (a test fixture, or a hand-built request)
  // opts an upload batch into kicking off permit.extract. Absent = just
  // store the files, matching lib/inngest/client.ts's documented event
  // source.
  const triggerExtraction = formData.get('complete') === 'true';

  // RLS-scoped: a non-member gets zero rows, not an error, which is why this
  // becomes a 404 rather than a 403 -- it doesn't confirm or deny that the
  // applicationId exists for a caller who isn't a member of its org.
  const { data: application, error: applicationError } = await supabase
    .from('permit_applications')
    .select('id, org_id')
    .eq('id', applicationId)
    .maybeSingle();

  if (applicationError) {
    return NextResponse.json({ error: applicationError.message }, { status: 500 });
  }
  if (!application) {
    return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  }

  // Health-check audit finding: this query had no .range() pagination, so it
  // silently undercounted an application's running byte total (and thus let
  // MAX_APPLICATION_TOTAL_BYTES be bypassed) once a single application
  // accumulated more than 1000 document rows -- same PostgREST 1000-row-cap
  // class of bug fixed elsewhere via lib/supabase/paginate.ts. Note this
  // check is a fast pre-upload rejection only, not the source of truth for
  // the cap -- migration 20260806000043's database trigger is what actually
  // closes the concurrent-request race this check-then-act pattern can't.
  let existingDocs: { byte_size: number }[];
  try {
    existingDocs = await fetchAllRows<{ byte_size: number }>(
      (from, to) =>
        supabase.from('application_documents').select('byte_size').eq('application_id', applicationId).range(from, to),
      'existing application documents'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load existing documents.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let runningTotal = existingDocs.reduce((sum, d) => sum + Number(d.byte_size), 0);

  // SS4.1: 25 MB/file, 100 MB/application, MIME allow-list -- validated here
  // as the first gate, before either the Storage bucket policy or the
  // application_documents.byte_size CHECK constraint would catch it.
  for (const file of files) {
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        {
          error: `${file.name}: mime type "${file.type}" is not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `${file.name}: ${file.size} bytes exceeds the ${MAX_FILE_SIZE_BYTES}-byte per-file limit.` },
        { status: 400 }
      );
    }
    runningTotal += file.size;
    if (runningTotal > MAX_APPLICATION_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Upload would exceed the ${MAX_APPLICATION_TOTAL_BYTES}-byte per-application total.` },
        { status: 400 }
      );
    }
  }

  const insertedIds: string[] = [];
  // Health-check audit finding: the original version of this loop returned
  // immediately on the first per-file upload/insert error, discarding the
  // response before the client ever learned which earlier files in the same
  // batch *had* already succeeded (their rows were committed to
  // application_documents, but the 500 response body carried no record of
  // that). The caller (document-upload.tsx) showed only a generic error and
  // never called router.refresh(), so a partially-successful batch looked
  // like a total failure even though some files were, in fact, safely
  // stored. Every file is now processed independently -- one file's failure
  // doesn't abort the rest of the batch -- and the response reports both
  // what succeeded and what failed, so the client can render an accurate
  // picture and the user knows exactly which files (if any) need retrying.
  const failures: { file: string; error: string }[] = [];

  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = computeSha256(bytes);
      const storagePath = buildStoragePath(application.org_id, applicationId, sha256, file.name);

      const { error: uploadError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .upload(storagePath, bytes, { contentType: file.type, upsert: false });

      // The sha256-in-path convention makes a re-upload of an identical file
      // land on the same object path -- "already exists" is a legitimate
      // no-op re-submission, not a failure, so it falls through to the insert
      // below (which is itself deduped by the (application_id, sha256)
      // unique constraint, 20260806000006).
      if (uploadError && !/duplicate|already exists/i.test(uploadError.message)) {
        failures.push({ file: file.name, error: uploadError.message });
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('application_documents')
        .insert({
          application_id: applicationId,
          storage_path: storagePath,
          original_filename: file.name,
          mime_type: file.type,
          byte_size: file.size,
          sha256,
          doc_kind: docKind,
        })
        .select('id')
        .maybeSingle();

      if (insertError) {
        if (!/duplicate key value/i.test(insertError.message)) {
          failures.push({ file: file.name, error: insertError.message });
        }
        // Duplicate (application_id, sha256): already recorded, not an error.
      } else if (inserted) {
        insertedIds.push(inserted.id);
      }
    } catch (err) {
      failures.push({ file: file.name, error: err instanceof Error ? err.message : 'Upload failed.' });
    }
  }

  // Only auto-start extraction when this batch was entirely clean (every
  // file either inserted or was a harmless duplicate no-op) -- firing
  // permit/application.documents_ready after a partially-failed "last
  // upload" batch would kick off extraction while the applicant still
  // believes a file is missing. A caller that wants to retry the failed
  // files and then trigger extraction can simply resubmit with `complete`
  // set once every file has succeeded.
  const triggeredExtraction = triggerExtraction && failures.length === 0;
  if (triggeredExtraction) {
    await inngest.send({
      name: 'permit/application.documents_ready',
      data: { applicationId } satisfies PermitEventPayloads['permit/application.documents_ready'],
    });
  }

  if (failures.length > 0 && insertedIds.length === 0) {
    return NextResponse.json({ documentIds: [], failures, triggeredExtraction }, { status: 500 });
  }

  return NextResponse.json(
    { documentIds: insertedIds, failures, triggeredExtraction },
    { status: failures.length > 0 ? 207 : 201 }
  );
}
