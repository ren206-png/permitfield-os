import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { OVERLAY_FONT_SIZE } from './config';

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

    page.drawText(instruction.value, {
      x: instruction.x,
      y: instruction.y,
      size: OVERLAY_FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
    filledCount++;
  }

  const filledBytes = await pdfDoc.save();
  return { filledBytes, filledCount };
}
