// Gate 4 (Quotes & Payments), Phase A -- generates a PDF rendering of a sent
// estimate revision (the immutable estimate_revisions snapshot, never the
// mutable draft) using pdf-lib, following this codebase's existing
// lib/pdf/ conventions (embedFont(StandardFonts.Helvetica), page.drawText(),
// PDFDocument.save()) via the shared lib/pdf/qp-pdf-layout.ts writer.
//
// This module takes plain data in, not a Supabase client or an org id --
// same "pure rendering function, caller already resolved the data" split
// lib/pdf/fill-acroform.ts/lib/pdf/overlay-coordinates.ts already use (they
// take `templateBytes` + already-resolved `instructions`, not a DB
// reference) -- so this file has zero DB dependency and is trivially unit
// testable.
//
// All money values are bigint cents in, formatted for display exclusively
// via lib/money/cents.ts's centsToDollarsString() -- never toFixed() or
// Intl.NumberFormat, per this codebase's money discipline.
import { centsToDollarsString } from '@/lib/money/cents';
import { QP_PDF_HEADING_FONT_SIZE, QP_PDF_MARGIN, QP_PDF_TITLE_FONT_SIZE } from './config';
import { QpPdfWriter, splitLines, wrapWords } from './qp-pdf-layout';

export interface EstimatePdfLineItem {
  description: string;
  quantity: string;
  unitPriceCents: bigint;
  lineDiscountCents: bigint;
  gstHstCents: bigint;
  pstCents: bigint;
  lineTotalCents: bigint;
}

export interface EstimatePdfInput {
  orgLegalName: string;
  orgAddressLines?: readonly string[];
  clientName: string;
  estimateId: string;
  revisionNumber: number;
  sentAt: string;
  expiryDate?: string | null;
  currencyCode: string;
  scopeNotes?: string | null;
  exclusions?: string | null;
  terms?: string | null;
  lineItems: readonly EstimatePdfLineItem[];
  subtotalCents: bigint;
  discountTotalCents: bigint;
  taxTotalCents: bigint;
  totalCents: bigint;
  // Present once the client has accepted this revision. esign fields are
  // null for acceptances recorded before e-signature capture existed.
  acceptance?: EstimatePdfAcceptance | null;
}

export interface EstimatePdfAcceptance {
  typedName: string;
  claimedAuthority: string;
  acceptedAt: string;
  ip: string | null;
  documentHash: string;
  signatureMethod: 'typed' | 'drawn' | null;
  signaturePng: Uint8Array | null;
  esignConsentText: string | null;
}

const COL_DESC_X = QP_PDF_MARGIN;
const COL_QTY_X = QP_PDF_MARGIN + 260;
const COL_UNIT_X = QP_PDF_MARGIN + 320;
const COL_TAX_X = QP_PDF_MARGIN + 400;
const COL_TOTAL_X = QP_PDF_MARGIN + 460;

/**
 * Renders `input` (an already-computed estimate revision snapshot -- the
 * caller is responsible for having called sendEstimate()/computeTaxOutcome()
 * first) to a PDF byte buffer. Never re-derives or re-sums any monetary
 * value -- every number drawn on the page is exactly the value passed in,
 * formatted for display only.
 */
export async function generateEstimatePdf(input: EstimatePdfInput): Promise<Uint8Array> {
  const writer = await QpPdfWriter.create();

  writer.drawLine('ESTIMATE', { size: QP_PDF_TITLE_FONT_SIZE, bold: true });
  writer.spacer();
  writer.drawLine(input.orgLegalName, { bold: true });
  for (const line of input.orgAddressLines ?? []) {
    writer.drawLine(line);
  }
  writer.spacer();
  writer.drawLine(`Estimate: ${input.estimateId} (revision ${input.revisionNumber})`);
  writer.drawLine(`Prepared for: ${input.clientName}`);
  writer.drawLine(`Sent: ${input.sentAt}`);
  if (input.expiryDate) {
    writer.drawLine(`Expires: ${input.expiryDate}`);
  }
  writer.drawLine(`Currency: ${input.currencyCode}`);
  writer.spacer();

  if (input.scopeNotes) {
    writer.drawLine('Scope', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
    for (const line of splitLines(input.scopeNotes)) {
      writer.drawLine(line);
    }
    writer.spacer();
  }

  if (input.exclusions) {
    writer.drawLine('Exclusions', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });
    for (const line of splitLines(input.exclusions)) {
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

  if (input.acceptance) {
    await drawAcceptance(writer, input.acceptance);
  }

  return writer.save();
}

const CERTIFICATE_WRAP_CHARS = 95;

async function drawAcceptance(writer: QpPdfWriter, acceptance: EstimatePdfAcceptance): Promise<void> {
  writer.spacer();
  const signed = acceptance.signatureMethod !== null;
  writer.drawLine(signed ? 'Electronic signature' : 'Acceptance', { size: QP_PDF_HEADING_FONT_SIZE, bold: true });

  if (acceptance.signatureMethod === 'drawn' && acceptance.signaturePng) {
    await writer.drawPng(acceptance.signaturePng, 200, 60);
  } else if (acceptance.signatureMethod === 'typed') {
    writer.drawLine(acceptance.typedName, { size: QP_PDF_TITLE_FONT_SIZE, italic: true });
  }

  writer.drawLine(`${signed ? 'Signed' : 'Accepted'} by: ${acceptance.typedName} (${acceptance.claimedAuthority})`);
  writer.drawLine(`${signed ? 'Signed' : 'Accepted'} at: ${formatUtc(acceptance.acceptedAt)}`);
  if (acceptance.ip) {
    writer.drawLine(`IP address: ${acceptance.ip}`);
  }
  if (signed) {
    writer.drawLine(`Signature method: ${acceptance.signatureMethod === 'drawn' ? 'drawn' : 'typed name'}`);
  }
  writer.drawLine('Document fingerprint (SHA-256):');
  writer.drawLine(acceptance.documentHash);
  if (acceptance.esignConsentText) {
    const [first, ...rest] = wrapWords(`Consent given: "${acceptance.esignConsentText}"`, CERTIFICATE_WRAP_CHARS);
    writer.drawLine(first);
    for (const line of rest) {
      writer.drawLine(line);
    }
  }
}

function formatUtc(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}
