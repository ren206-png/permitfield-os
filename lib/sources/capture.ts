import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chunkText } from '@/lib/ai/chunk-text';
import type { LocatedSection } from './loaders';

// Gate 6.3: the staged form of a fetched source (source_captures, migration
// 20260806000094). The hash is over the normalised text, not the raw bytes,
// so a page whose markup changes on every request (tokens, timestamps in
// attributes) is not reported as a new revision -- only a change in the text
// a reviewer would read is. Size limits mirror the table's CHECKs; content
// over them is refused, never truncated (a cut-off source would silently
// lose requirements).

export const MAX_CAPTURE_TEXT_CHARS = 1_000_000;
export const MAX_CAPTURE_CHUNKS = 2000;
export const CAPTURE_CHUNK_CHARS = 1500;

export const CaptureChunkSchema = z.strictObject({
  index: z.number().int().min(0),
  locator: z.string().trim().min(1).max(300),
  content: z.string().min(1).max(8000),
});

export const SourceCaptureSchema = z.strictObject({
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  loader: z.enum(['html', 'pdf', 'text']),
  loader_version: z.string().min(1).max(50),
  text: z.string().min(1).max(MAX_CAPTURE_TEXT_CHARS),
  chunks: z.array(CaptureChunkSchema).min(1).max(MAX_CAPTURE_CHUNKS),
});

export type SourceCapture = z.infer<typeof SourceCaptureSchema>;

export function sectionsToText(sections: readonly LocatedSection[]): string {
  return sections.map((s) => `[${s.locator}]\n${s.text}`).join('\n\n');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type BuildCaptureResult = { ok: true; capture: SourceCapture } | { ok: false; code: 'too_large'; message: string };

export function buildCapture(
  loader: SourceCapture['loader'],
  loaderVersion: string,
  sections: readonly LocatedSection[]
): BuildCaptureResult {
  const text = sectionsToText(sections);
  if (text.length > MAX_CAPTURE_TEXT_CHARS) {
    return { ok: false, code: 'too_large', message: `Extracted text exceeds ${MAX_CAPTURE_TEXT_CHARS} characters.` };
  }
  const chunks: SourceCapture['chunks'] = [];
  for (const section of sections) {
    for (const content of chunkText(section.text, { maxChars: CAPTURE_CHUNK_CHARS })) {
      chunks.push({ index: chunks.length, locator: section.locator, content });
    }
  }
  if (chunks.length > MAX_CAPTURE_CHUNKS) {
    return { ok: false, code: 'too_large', message: `Source splits into more than ${MAX_CAPTURE_CHUNKS} chunks.` };
  }
  // Parse, don't trust: the same schema guards the RPC payload.
  const capture = SourceCaptureSchema.parse({
    content_sha256: sha256Hex(text),
    loader,
    loader_version: loaderVersion,
    text,
    chunks,
  });
  return { ok: true, capture };
}
