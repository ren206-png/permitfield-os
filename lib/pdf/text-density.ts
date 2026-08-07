import { PDFParse } from 'pdf-parse';

// SS7 adversarial self-check #2 ("the scanned blueprint"): a 40 MB flat scan
// run through a text extractor doesn't throw -- it returns a handful of
// stray characters (OCR artifacts, form chrome) and looks superficially like
// a successful parse. A raw try/catch is not enough; this threshold is what
// actually decides whether a document is text-native or needs the vision
// path. Tuned low deliberately: false negatives here (routing a genuinely
// text-native page to vision) just cost more tokens, but false positives
// (auditing a blank page as if it were real extracted text) produce
// confidently-wrong findings, which SS0.1 treats as the worse failure mode.
export const MIN_CHARS_PER_PAGE_FOR_TEXT_ROUTE = 40;

export type ExtractionRoute = 'text' | 'vision';

export interface TextDensityResult {
  route: ExtractionRoute;
  charCount: number;
  pageCount: number;
  charsPerPage: number;
  // Populated only when route === 'text'; the vision path sends the raw PDF
  // bytes to the model instead (see lib/ai/extract-permit-data.ts) and never
  // reads this field.
  extractedText: string | null;
}

/**
 * Decides whether a PDF's text layer is dense enough to extract from
 * directly (`pdf-parse`) or whether it must be routed to Claude's native PDF
 * vision path (scanned pages, drawings, or a corrupt/absent text layer).
 */
export async function computeTextDensity(bytes: Buffer): Promise<TextDensityResult> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const pageCount = Math.max(result.total, 1);
    // Whitespace-only "text" (common in flattened form exports -- see
    // PHASE_0_FINDINGS.md SS4 on the ESA ICIA-LV form) doesn't count as
    // signal; strip it before measuring density.
    const charCount = result.text.replace(/\s+/g, '').length;
    const charsPerPage = charCount / pageCount;
    const route: ExtractionRoute =
      charsPerPage >= MIN_CHARS_PER_PAGE_FOR_TEXT_ROUTE ? 'text' : 'vision';

    return {
      route,
      charCount,
      pageCount,
      charsPerPage,
      extractedText: route === 'text' ? result.text : null,
    };
  } catch {
    // pdf-parse throws outright on some scanned-only / malformed PDFs. That
    // failure is itself signal, not an error to propagate up into the
    // Inngest function -- treat it as maximally low density and route to
    // vision rather than failing the whole extraction.
    return { route: 'vision', charCount: 0, pageCount: 1, charsPerPage: 0, extractedText: null };
  } finally {
    await parser?.destroy();
  }
}
