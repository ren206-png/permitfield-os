import type { PDFParse as PDFParseType } from 'pdf-parse';
import { createPdfParser } from '@/lib/pdf/pdf-parse';

// Gate 6.3: turns fetched source bytes into located text sections (master
// prompt §10). Supported: HTML, PDF (text layer), plain text. Everything
// else -- DOCX, spreadsheets, images, archives -- is rejected explicitly as
// unsupported rather than read as text; a scanned PDF with no usable text
// layer is rejected as empty, never sent anywhere for OCR from here.
//
// The declared content type must agree with the file signature: a "PDF"
// that doesn't start with %PDF-, or "HTML" that is binary, is refused.
// Nothing here executes content: scripts, styles and embedded objects are
// dropped from HTML before any text is read.

export const LOADER_VERSION = 'sources-v1';
export const MAX_SECTION_CHARS = 200_000;

export interface LocatedSection {
  locator: string;
  text: string;
}

export type LoadResult =
  | { ok: true; loader: 'html' | 'pdf' | 'text'; loaderVersion: string; sections: LocatedSection[] }
  | { ok: false; code: 'unsupported_content' | 'signature_mismatch' | 'empty_text' | 'parse_failed'; message: string };

function mediaType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096);
  return sample.includes(0);
}

export async function loadSourceDocument(bytes: Buffer, contentType: string): Promise<LoadResult> {
  const type = mediaType(contentType);

  if (type === 'application/pdf') {
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return { ok: false, code: 'signature_mismatch', message: 'Declared as PDF but is not a PDF file.' };
    }
    return loadPdf(bytes);
  }

  if (type === 'text/html' || type === 'application/xhtml+xml') {
    if (looksBinary(bytes)) return { ok: false, code: 'signature_mismatch', message: 'Declared as HTML but contains binary data.' };
    const sections = htmlToSections(bytes.toString('utf8'));
    return withSections('html', sections);
  }

  if (type === 'text/plain') {
    if (looksBinary(bytes)) return { ok: false, code: 'signature_mismatch', message: 'Declared as text but contains binary data.' };
    const text = normalizeWhitespace(bytes.toString('utf8'));
    return withSections('text', text ? [{ locator: 'Document', text }] : []);
  }

  return { ok: false, code: 'unsupported_content', message: `Content type "${type || 'unknown'}" is not supported for sources.` };
}

function withSections(loader: 'html' | 'pdf' | 'text', sections: LocatedSection[]): LoadResult {
  const kept = sections
    .map((s) => ({ locator: s.locator.slice(0, 300), text: s.text.slice(0, MAX_SECTION_CHARS) }))
    .filter((s) => s.text.trim().length > 0);
  if (kept.length === 0) return { ok: false, code: 'empty_text', message: 'No readable text was found.' };
  return { ok: true, loader, loaderVersion: LOADER_VERSION, sections: kept };
}

async function loadPdf(bytes: Buffer): Promise<LoadResult> {
  let parser: PDFParseType | null = null;
  try {
    // Loaded lazily, with the canvas globals pdfjs needs (lib/pdf/pdf-parse.ts).
    parser = await createPdfParser(bytes);
    const result = await parser.getText();
    const sections = result.pages.map((page) => ({ locator: `p. ${page.num}`, text: normalizeWhitespace(page.text) }));
    return withSections('pdf', sections);
  } catch (error) {
    return { ok: false, code: 'parse_failed', message: error instanceof Error ? error.message.slice(0, 300) : 'PDF could not be read.' };
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  sect: '§', para: '¶', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', times: '×', sup2: '²', sup3: '³',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DROPPED_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'head', 'nav', 'footer', 'form', 'select'];
const BLOCK_TAGS = /<\/?(p|div|section|article|li|ul|ol|table|tr|td|th|thead|tbody|br|hr|dd|dt|dl|blockquote|pre|figure|figcaption|header|main|aside)\b[^>]*>/gi;

// Splits a page into sections at h1–h4, each located by its heading path
// ("Permits › Fees"). If the page has a <main>, only that is read, so site
// navigation and footers don't become "requirements".
export function htmlToSections(html: string): LocatedSection[] {
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROPPED_ELEMENTS) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
  }
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  if (main) body = main[1];

  const sections: LocatedSection[] = [];
  // One slot per heading level; a heading clears every deeper level.
  const levels: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  let buffer = '';
  const flush = () => {
    const text = normalizeWhitespace(decodeEntities(buffer.replace(BLOCK_TAGS, '\n').replace(/<[^>]+>/g, ' ')));
    const path = levels.filter((l): l is string => Boolean(l));
    if (text) sections.push({ locator: path.length ? path.join(' › ') : 'Page', text });
    buffer = '';
  };

  const headingPattern = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let last = 0;
  for (let m = headingPattern.exec(body); m; m = headingPattern.exec(body)) {
    buffer += body.slice(last, m.index);
    flush();
    const level = Number(m[1]);
    const title = normalizeWhitespace(decodeEntities(m[2].replace(/<[^>]+>/g, ' '))).replace(/\n/g, ' ');
    for (let i = level - 1; i < levels.length; i++) levels[i] = undefined;
    levels[level - 1] = title ? title.slice(0, 120) : undefined;
    last = m.index + m[0].length;
  }
  buffer += body.slice(last);
  flush();
  return sections;
}
