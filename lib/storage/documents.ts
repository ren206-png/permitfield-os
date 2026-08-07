import { createHash } from 'node:crypto';

// SS4.1: 25 MB/file, 100 MB/application. The per-file cap is also enforced
// at the database layer (application_documents.byte_size CHECK, migration
// 20260806000006) as defense-in-depth -- this is the first gate, not the
// only one.
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_APPLICATION_TOTAL_BYTES = 100 * 1024 * 1024;

// MIME allow-list for permit application uploads: PDFs (the overwhelming
// common case) plus common scanned-drawing image formats. Deliberately does
// not include arbitrary office formats -- there is no code path that reads
// them.
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function computeSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Storage path convention: `${orgId}/${applicationId}/${sha256}-${filename}`.
// The leading orgId segment is load-bearing, not cosmetic -- the storage.objects
// RLS policies (migration 20260806000013) read it back out via
// storage.foldername(name)[1] to authorize access, mirroring the org_id
// scoping every other tenant table uses.
export function buildStoragePath(
  orgId: string,
  applicationId: string,
  sha256: string,
  originalFilename: string
): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return `${orgId}/${applicationId}/${sha256}-${safeName}`;
}

export const UPLOADS_BUCKET = process.env.PERMITFIELD_STORAGE_BUCKET_UPLOADS ?? 'permitfield-uploads';
export const GENERATED_BUCKET =
  process.env.PERMITFIELD_STORAGE_BUCKET_GENERATED ?? 'permitfield-generated';
// Phase 4: blank government PDF templates (permit_type_filings.form_template_path
// is a path within this bucket), created in migration
// 20260806000017_filing_form_templates_and_generated_documents.sql.
export const FORM_TEMPLATES_BUCKET =
  process.env.PERMITFIELD_STORAGE_BUCKET_FORM_TEMPLATES ?? 'permitfield-form-templates';
