import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { OVERLAY_FONT_SIZE } from './config';

const OVERLAY_LINE_GAP = 2;

// The standard fonts only cover WinAnsi; drawText() throws on anything else
// (e.g. a name in Chinese characters), which would fail the whole form.
// Unencodable characters become '?', same as the signature stamper.
function winAnsiSafe(encodable: Set<number>, text: string): string {
  let out = '';
  for (const ch of text.replace(/\s+/g, ' ')) out += encodable.has(ch.codePointAt(0)!) ? ch : '?';
  return out;
}

/**
 * Splits text into the lines to draw: one line as-is when there is no width
 * limit, otherwise word-wrapped to maxWidth and, when maxLines is set, cut
 * to that many lines with a trailing "..." so it never runs off its box.
 */
export function layoutOverlayText(
  text: string,
  options: { maxWidth: number | null; maxLines: number | null; measure: (text: string) => number }
): string[] {
  const { maxWidth, maxLines, measure } = options;
  if (!maxWidth) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!maxLines || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}...`;
  while (measure(last) > maxWidth && last.length > 3) last = `${last.slice(0, -4)}...`;
  kept[maxLines - 1] = last;
  return kept;
}

// Coordinate-overlay filling for flat (non-AcroForm) templates -- Phase 0's
// inspection found ESA's ICIA Low Voltage form has zero AcroForm fields
// (PHASE_0_FINDINGS.md), so there is nothing to look up by field name;
// instead, permit_form_fields.overlay_page/overlay_x/overlay_y (hand-
// measured against the rendered PDF, when they exist -- see supabase/seed.sql's
// header comment on why no such coordinates are seeded yet for a real form)
// specify exactly where to draw each value's text directly onto the page.

export interface OverlayFillInstruction {
  // 1-indexed, matching permit_form_fields.overlay_page's documented
  // convention (page 1 is the first page of the PDF).
  page: number;
  x: number;
  y: number;
  // null means "leave this field blank" -- same contract as
  // AcroFormFillInstruction.value (lib/pdf/fill-acroform.ts).
  value: string | null;
  /** Wrap within this width (points); with maxLines, extra text is cut and ends in "...". */
  maxWidth?: number | null;
  maxLines?: number | null;
  /** Defaults to OVERLAY_FONT_SIZE; smaller for tight table cells. */
  fontSize?: number | null;
}

export interface OverlayFillResult {
  filledBytes: Uint8Array;
  filledCount: number;
}

/**
 * Draws each instruction's value as text at its given page/x/y. An
 * out-of-range page number throws (same "fail loudly on a data-integrity
 * mismatch" posture as fillAcroForm) rather than silently drawing nothing.
 */
export async function fillOverlay(
  templateBytes: Uint8Array,
  instructions: OverlayFillInstruction[]
): Promise<OverlayFillResult> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());
  const pages = pdfDoc.getPages();
  let filledCount = 0;

  for (const instruction of instructions) {
    if (instruction.value === null) continue;

    const page = pages[instruction.page - 1];
    if (!page) {
      throw new Error(
        `overlay_page ${instruction.page} does not exist on this template (it has ${pages.length} page(s)).`
      );
    }

    const size = instruction.fontSize ?? OVERLAY_FONT_SIZE;
    const lines = layoutOverlayText(winAnsiSafe(encodable, instruction.value), {
      maxWidth: instruction.maxWidth ?? null,
      maxLines: instruction.maxLines ?? null,
      measure: (text) => font.widthOfTextAtSize(text, size),
    });
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: instruction.x,
        y: instruction.y - i * (size + OVERLAY_LINE_GAP),
        size,
        font,
        color: rgb(0, 0, 0),
      });
    });
    filledCount++;
  }

  const filledBytes = await pdfDoc.save();
  return { filledBytes, filledCount };
}
