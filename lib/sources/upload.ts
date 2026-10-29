import { buildCapture, type SourceCapture } from './capture';
import { loadSourceDocument } from './loaders';

// An admin's uploaded copy of an official source (migration
// 20260806000100), for sites the automated check cannot fetch. The bytes go
// through the same loaders and capture builder as a fetch, so an uploaded
// copy is staged, diffed and reviewed exactly like a fetched one.
//
// The size cap stays under Vercel's 4.5 MB request-body limit, so an
// oversized file gets this message instead of a platform error.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_FILE_NAME_CHARS = 255;

const TEXT_TYPES: Record<string, string> = {
  'text/html': 'text/html',
  'application/xhtml+xml': 'application/xhtml+xml',
  'text/plain': 'text/plain',
};
const TEXT_EXTENSIONS: Record<string, string> = { html: 'text/html', htm: 'text/html', txt: 'text/plain' };

export type PreparedUpload =
  | { ok: true; fileName: string; contentType: string; byteLength: number; capture: SourceCapture }
  | { ok: false; status: 400 | 413 | 415 | 422; message: string };

// Only the last path segment, no control characters, at most 255 chars.
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_FILE_NAME_CHARS);
  return cleaned || 'upload';
}

// The PDF signature decides first; otherwise the declared type, then the
// extension. The loaders re-check the signature against the type chosen.
export function detectContentType(bytes: Buffer, declaredType: string, fileName: string): string | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const declared = declaredType.split(';')[0].trim().toLowerCase();
  if (TEXT_TYPES[declared]) return TEXT_TYPES[declared];
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  return TEXT_EXTENSIONS[extension] ?? null;
}

export async function prepareUploadedSource(bytes: Buffer, declaredType: string, rawFileName: string): Promise<PreparedUpload> {
  if (bytes.length === 0) return { ok: false, status: 400, message: 'The file is empty.' };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, message: `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  }
  const fileName = cleanFileName(rawFileName);
  const contentType = detectContentType(bytes, declaredType, fileName);
  if (!contentType) return { ok: false, status: 415, message: 'Upload a PDF, HTML page or plain-text file.' };

  const loaded = await loadSourceDocument(bytes, contentType);
  if (!loaded.ok) return { ok: false, status: 422, message: loaded.message };
  const built = buildCapture(loaded.loader, loaded.loaderVersion, loaded.sections);
  if (!built.ok) return { ok: false, status: 413, message: built.message };
  return { ok: true, fileName, contentType, byteLength: bytes.length, capture: built.capture };
}
