// Gate 4 (Quotes & Payments), Phase B -- generates a PDF rendering of an
// issued credit note using pdf-lib. Mirrors lib/pdf/invoice-pdf.ts's
// structure (see that file's header comment for the shared pure-data-in,
// QpPdfWriter-layout, cents-in/centsToDollarsString-for-display-only
// discipline), but with no line-items table -- credit_notes has no line
// items of its own (see lib/quotes-payments/credit-notes.ts's header
// comment on why this artifact is deliberately thinner). A single
// signed-positive amount, the reason, and which invoice it was applied
// against are the whole document.
import { centsToDollarsString } from '@/lib/money/cents';
import { QP_PDF_HEADING_FONT_SIZE, QP_PDF_TITLE_FONT_SIZE } from './config';
import { QpPdfWriter, splitLines } from './qp-pdf-layout';

export interface CreditNotePdfInput {
  orgLegalName: string;
  orgAddressLines?: readonly string[];
  clientName: string;
  creditNoteId: string;
  creditNoteNumber: bigint;
  status: 'issued' | 'void';
  issuedAt: string;
  voidedAt?: string | null;
  voidReason?: string | null;
  currencyCode: string;
  reason?: string | null;
  invoiceNumber?: bigint | null;
  amountCents: bigint;
  documentHash?: string | null;
}

/**
 * Renders `input` (an already-issued credit note -- the caller is
 * responsible for having called issueCreditNote() first, and for passing
 * the issued_amount_cents column, not the mutable draft amount_cents) to a
 * PDF byte buffer. A voided credit note (`status: 'void'`) is still
 * rendered in full with a visible "VOID" marker and the void reason, same
 * "no cascading delete of issued financial history" reasoning as
 * generateInvoicePdf()'s own doc comment.
 */
export async function generateCreditNotePdf(input: CreditNotePdfInput): Promise<Uint8Array> {
  const writer = await QpPdfWriter.create();

  const title = input.status === 'void' ? 'CREDIT NOTE (VOID)' : 'CREDIT NOTE';
  writer.drawLine(title, { size: QP_PDF_TITLE_FONT_SIZE, bold: true });
  writer.spacer();
  writer.drawLine(input.orgLegalName, { bold: true });
  for (const line of input.orgAddressLines ?? []) {
    writer.drawLine(line);
  }
  writer.spacer();
  writer.drawLine(`Credit note #: ${input.creditNoteNumber.toString()}`);
  writer.drawLine(`Issued to: ${input.clientName}`);
  writer.drawLine(`Issued: ${input.issuedAt}`);
  if (input.invoiceNumber !== null && input.invoiceNumber !== undefined) {
    writer.drawLine(`Applied to invoice #: ${input.invoiceNumber.toString()}`);
  }
  writer.drawLine(`Currency: ${input.currencyCode}`);
  if (input.status === 'void') {
    writer.drawLine(`Voided: ${input.voidedAt ?? ''}`, { bold: true });
    if (input.voidReason) {
      writer.drawLine(`Void reason: ${input.voidReason}`);
    }
  }
  writer.spacer();

  if (input.reason) {
    writer.drawLine('Reason', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
    for (const line of splitLines(input.reason)) {
      writer.drawLine(line);
    }
    writer.spacer();
  }

  writer.drawLine('Amount', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
  writer.drawLine(centsToDollarsString(input.amountCents), { bold: true });

  if (input.documentHash) {
    writer.spacer();
    writer.drawLine(`Document hash: ${input.documentHash}`, { size: 8 });
  }

  return writer.save();
}
