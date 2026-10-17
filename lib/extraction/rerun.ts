import { createHash } from 'node:crypto';

// When "start AI extraction" may (re)run, and what identifies one run.
// app/api/documents/route.ts decides with these before it sends
// 'permit/application.documents_ready'; extract.ts and
// classify-documents.ts key their Inngest idempotency on the fingerprint.

// The set of documents a run reads: the same files in any order give the
// same fingerprint (a double-click, or re-uploading a file that's already
// there, collapses), and any new file gives a new one (a fresh run).
export function documentsFingerprint(sha256s: readonly string[]): string {
  const sorted = [...new Set(sha256s)].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 32);
}

// The AI pipeline is still working on the application.
const IN_PROGRESS_STATUSES = new Set(['uploading', 'extracting', 'auditing', 'generating_documents']);

// Why a new extraction must not start, or null when it may. Re-running
// rewrites the application's pipeline status and refills its forms, so it
// is refused once the application is submitted (it would undo
// "Submitted") or once a form has been signed (the refill would replace the
// signed copy as the one to file).
export function extractionBlockReason(input: { status: string; hasSignedForm: boolean }): string | null {
  if (input.status === 'submitted') {
    return 'This application has already been submitted, so AI extraction was not run again. Your files were saved.';
  }
  if (IN_PROGRESS_STATUSES.has(input.status)) {
    return 'AI extraction is already running for this application. Your files were saved -- once it finishes, upload again with the box ticked to include them.';
  }
  if (input.hasSignedForm) {
    return 'A form on this application is already signed, so AI extraction was not run again (it would replace the signed copy). Your files were saved.';
  }
  return null;
}
