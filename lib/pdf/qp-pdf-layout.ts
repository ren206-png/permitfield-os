// Gate 4 (Quotes & Payments), Phase A -- shared line-writing helper for
// lib/pdf/estimate-pdf.ts and lib/pdf/invoice-pdf.ts. Both generate a
// brand-new multi-page text document (not an overlay/AcroForm fill), so both
// need the same "keep a running y-cursor, start a new page when it runs off
// the bottom margin" bookkeeping -- pulled out here once rather than
// duplicated in both files, matching this codebase's general small-shared-
// helper convention (e.g. lib/quotes-payments/tax-result.ts existing
// specifically so estimates.ts/invoices.ts share one tax-outcome path rather
// than two that could drift).
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  QP_PDF_BODY_FONT_SIZE,
  QP_PDF_LINE_HEIGHT,
  QP_PDF_MARGIN,
  QP_PDF_PAGE_HEIGHT,
  QP_PDF_PAGE_WIDTH,
} from './config';

export class QpPdfWriter {
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly boldFont: PDFFont;
  private page: PDFPage;
  private y: number;

  private constructor(doc: PDFDocument, font: PDFFont, boldFont: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.boldFont = boldFont;
    this.page = doc.addPage([QP_PDF_PAGE_WIDTH, QP_PDF_PAGE_HEIGHT]);
    this.y = QP_PDF_PAGE_HEIGHT - QP_PDF_MARGIN;
  }

  static async create(): Promise<QpPdfWriter> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    return new QpPdfWriter(doc, font, boldFont);
  }

  /** Starts a fresh page and resets the y-cursor to the top margin. */
  private newPage(): void {
    this.page = this.doc.addPage([QP_PDF_PAGE_WIDTH, QP_PDF_PAGE_HEIGHT]);
    this.y = QP_PDF_PAGE_HEIGHT - QP_PDF_MARGIN;
  }

  /** Advances the y-cursor by `lines` line-heights, starting a new page first if the next line would fall below the bottom margin. */
  private ensureRoom(lines = 1): void {
    if (this.y - lines * QP_PDF_LINE_HEIGHT < QP_PDF_MARGIN) {
      this.newPage();
    }
  }

  /** Draws one line of text at the current x/y (left-aligned by default), then advances the cursor by one line height. Starts a new page first if needed. */
  drawLine(text: string, options: { x?: number; size?: number; bold?: boolean } = {}): void {
    this.ensureRoom(1);
    this.page.drawText(text, {
      x: options.x ?? QP_PDF_MARGIN,
      y: this.y,
      size: options.size ?? QP_PDF_BODY_FONT_SIZE,
      font: options.bold ? this.boldFont : this.font,
      color: rgb(0, 0, 0),
    });
    this.y -= QP_PDF_LINE_HEIGHT;
  }

  /** Draws a row of column values at fixed x-offsets on one line, then advances the cursor by one line height. `columns` is a list of `{ x, text, size?, bold? }`. */
  drawRow(columns: readonly { x: number; text: string; size?: number; bold?: boolean }[]): void {
    this.ensureRoom(1);
    for (const col of columns) {
      this.page.drawText(col.text, {
        x: col.x,
        y: this.y,
        size: col.size ?? QP_PDF_BODY_FONT_SIZE,
        font: col.bold ? this.boldFont : this.font,
        color: rgb(0, 0, 0),
      });
    }
    this.y -= QP_PDF_LINE_HEIGHT;
  }

  /** Blank-line vertical spacing, without drawing anything. */
  spacer(lines = 1): void {
    this.ensureRoom(lines);
    this.y -= lines * QP_PDF_LINE_HEIGHT;
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

/**
 * Splits `text` into hard lines on '\n' only (no word-wrap) -- free-text
 * fields here (scope_notes/exclusions/terms) are short operator-entered
 * notes, not long-form prose, and this gate's spec has no word-wrap
 * requirement; a caller with genuinely long free text gets one long,
 * possibly page-overflowing line rather than silently truncated or
 * incorrectly reflowed text. Documented here as a known Phase A limitation
 * rather than silently guessed at.
 */
export function splitLines(text: string): string[] {
  return text.split('\n');
}
