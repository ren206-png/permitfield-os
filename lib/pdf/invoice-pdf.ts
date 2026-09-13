// Gate 4 (Quotes & Payments), Phase A -- generates a PDF rendering of an
// issued invoice (the immutable issued_* snapshot columns, never the
// mutable draft) using pdf-lib. Mirrors lib/pdf/estimate-pdf.ts's structure
// deliberately -- same pure-data-in, shared QpPdfWriter layout, same
// cents-in/centsToDollarsString-for-display-only discipline -- see that
// file's header comment for the reasoning shared by both.
import { centsToDollarsString } from '@/lib/money/cents';
import { QP_PDF_HEADING_FONT_SIZE, QP_PDF_MARGIN, QP_PDF_TITLE_FONT_SIZE } from './config';
import { QpPdfWriter, splitLines } from './qp-pdf-layout';

export interface InvoicePdfLineItem {
  description: string;
  quantity: string;
  unitPriceCents: bigint;
  lineDiscountCents: bigint;
  gstHstCents: bigint;
  pstCents: bigint;
  lineTotalCents: bigint;
}

export interface InvoicePdfInput {
  orgLegalName: string;
  orgAddressLines?: readonly string[];
  clientName: string;
  invoiceId: string;
  invoiceNumber: bigint;
  status: 'issued' | 'void';
  issuedAt: string;
  dueDate?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  currencyCode: string;
  scopeNotes?: string | null;
  terms?: string | null;
  lineItems: readonly InvoicePdfLineItem[];
  subtotalCents: bigint;
  discountTotalCents: bigint;
  taxTotalCents: bigint;
  totalCents: bigint;
  documentHash?: string | null;
}

const COL_DESC_X = QP_PDF_MARGIN;
const COL_QTY_X = QP_PDF_MARGIN + 260;
const COL_UNIT_X = QP_PDF_MARGIN + 320;
const COL_TAX_X = QP_PDF_MARGIN + 400;
const COL_TOTAL_X = QP_PDF_MARGIN + 460;

/**
 * Renders `input` (an already-issued invoice's immutable snapshot -- the
 * caller is responsible for having called issueInvoice() first, and for
 * passing the issued_* columns, not the mutable draft totals) to a PDF byte
 * buffer. A voided invoice (`status: 'void'`) is still rendered in full
 * (never blanked out) with a visible "VOID" marker and the void reason, per
 * this gate's "no cascading delete of issued financial history" rule --
 * the historical document itself must remain reproducible even after
 * voiding, exactly as csv-export.ts's own header comment reasons for
 * including voided rows in the CSV export.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const writer = await QpPdfWriter.create();

  const title = input.status === 'void' ? 'INVOICE (VOID)' : 'INVOICE';
  writer.drawLine(title, { size: QP_PDF_TITLE_FONT_SIZE, bold: true });
  writer.spacer();
  writer.drawLine(input.orgLegalName, { bold: true });
  for (const line of input.orgAddressLines ?? []) {
    writer.drawLine(line);
  }
  writer.spacer();
  writer.drawLine(`Invoice #: ${input.invoiceNumber.toString()}`);
  writer.drawLine(`Billed to: ${input.clientName}`);
  writer.drawLine(`Issued: ${input.issuedAt}`);
  if (input.dueDate) {
    writer.drawLine(`Due: ${input.dueDate}`);
  }
  writer.drawLine(`Currency: ${input.currencyCode}`);
  if (input.status === 'void') {
    writer.drawLine(`Voided: ${input.voidedAt ?? ''}`, { bold: true });
    if (input.voidReason) {
      writer.drawLine(`Void reason: ${input.voidReason}`);
    }
  }
  writer.spacer();

  if (input.scopeNotes) {
    writer.drawLine('Scope', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
    for (const line of splitLines(input.scopeNotes)) {
      writer.drawLine(line);
    }
    writer.spacer();
  }

  writer.drawLine('Line items', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
  writer.drawRow([
    { x: COL_DESC_X, text: 'Description', bold: true },
    { x: COL_QTY_X, text: 'Qty', bold: true },
    { x: COL_UNIT_X, text: 'Unit', bold: true },
    { x: COL_TAX_X, text: 'Tax', bold: true },
    { x: COL_TOTAL_X, text: 'Total', bold: true },
  ]);

  for (const item of input.lineItems) {
    const taxCents = item.gstHstCents + item.pstCents;
    writer.drawRow([
      { x: COL_DESC_X, text: item.description },
      { x: COL_QTY_X, text: item.quantity },
      { x: COL_UNIT_X, text: centsToDollarsString(item.unitPriceCents) },
      { x: COL_TAX_X, text: centsToDollarsString(taxCents) },
      { x: COL_TOTAL_X, text: centsToDollarsString(item.lineTotalCents) },
    ]);
  }

  writer.spacer();
  writer.drawRow([
    { x: COL_TAX_X, text: 'Subtotal', bold: true },
    { x: COL_TOTAL_X, text: centsToDollarsString(input.subtotalCents) },
  ]);
  writer.drawRow([
    { x: COL_TAX_X, text: 'Discount', bold: true },
    { x: COL_TOTAL_X, text: centsToDollarsString(input.discountTotalCents) },
  ]);
  writer.drawRow([
    { x: COL_TAX_X, text: 'Tax', bold: true },
    { x: COL_TOTAL_X, text: centsToDollarsString(input.taxTotalCents) },
  ]);
  writer.drawRow([
    { x: COL_TAX_X, text: 'Total', bold: true },
    { x: COL_TOTAL_X, text: centsToDollarsString(input.totalCents), bold: true },
  ]);

  if (input.terms) {
    writer.spacer();
    writer.drawLine('Terms', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
    for (const line of splitLines(input.terms)) {
      writer.drawLine(line);
    }
  }

  if (input.documentHash) {
    writer.spacer();
    writer.drawLine(`Document hash: ${input.documentHash}`, { size: 8 });
  }

  return writer.save();
}
