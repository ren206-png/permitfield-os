// application_status enum, in the exact order it can progress
// (supabase/migrations 20260806000006, _000012, _000016). Kept as a literal
// union here (not imported from a generated DB types file, since this
// project has none -- see lib/supabase/server.ts) so a new enum value added
// in a migration fails this component at compile time via the `never` catch
// in the switch below, rather than silently rendering "status".
type ApplicationStatus =
  | 'draft'
  | 'uploading'
  | 'extracting'
  | 'extraction_failed'
  | 'extracted'
  | 'auditing'
  | 'audit_failed'
  | 'ready_for_review'
  | 'reviewed'
  | 'generating_documents'
  | 'document_generation_failed'
  | 'documents_generated'
  | 'submitted';

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  extracting: 'Extracting',
  extraction_failed: 'Extraction failed',
  extracted: 'Extracted',
  auditing: 'Auditing',
  audit_failed: 'Audit failed',
  ready_for_review: 'Ready for review',
  reviewed: 'Reviewed',
  generating_documents: 'Generating documents',
  document_generation_failed: 'Document generation failed',
  documents_generated: 'Documents ready',
  submitted: 'Submitted',
};

const FAILURE_STATUSES = new Set<ApplicationStatus>([
  'extraction_failed',
  'audit_failed',
  'document_generation_failed',
]);
const IN_PROGRESS_STATUSES = new Set<ApplicationStatus>([
  'uploading',
  'extracting',
  'auditing',
  'generating_documents',
]);
const SUCCESS_STATUSES = new Set<ApplicationStatus>(['documents_generated', 'submitted']);
const ATTENTION_STATUSES = new Set<ApplicationStatus>(['ready_for_review']);

export function StatusBadge({ status }: { status: string }) {
  const known = status as ApplicationStatus;
  const label = STATUS_LABELS[known] ?? status;

  let classes = 'bg-zinc-100 text-zinc-700'; // draft, extracted, reviewed -- neutral
  if (FAILURE_STATUSES.has(known)) {
    classes = 'bg-red-100 text-red-700';
  } else if (IN_PROGRESS_STATUSES.has(known)) {
    classes = 'bg-blue-100 text-blue-700';
  } else if (SUCCESS_STATUSES.has(known)) {
    classes = 'bg-green-100 text-green-700';
  } else if (ATTENTION_STATUSES.has(known)) {
    classes = 'bg-amber-100 text-amber-700';
  }

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
