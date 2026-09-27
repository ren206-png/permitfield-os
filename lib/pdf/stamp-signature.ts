import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFForm } from 'pdf-lib';
import { OVERLAY_FONT_SIZE } from './config';

// E-signature, Stage B: stamps one signer's signature onto an already-filled
// permit form (a generated_documents PDF), at the slot
// permit_form_signature_slots defines for that form. A drawn signature is
// placed as its PNG, scaled to fit the box; a typed one is set in an italic
// serif, the conventional typed-signature look. The signer's printed name and
// the signing date go into the form's own fields where it has them, or at
// overlay positions on the signature's page where it doesn't.
//
// A field name that doesn't exist on the document throws, same posture as
// fill-acroform.ts: a slot row that no longer matches its form is a data
// bug, never a reason to produce a half-signed government form.

export interface SignatureSlot {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signaturePdfFieldName: string | null;
  namePdfFieldName: string | null;
  nameX: number | null;
  nameY: number | null;
  datePdfFieldName: string | null;
  dateX: number | null;
  dateY: number | null;
  dateFormat: SignatureDateFormat;
}

export type SignatureDateFormat = 'yyyy-mm-dd' | 'mm/dd/yyyy' | 'dd-mm-yyyy';

export interface StampSignatureInput {
  pdfBytes: Uint8Array;
  slot: SignatureSlot;
  method: 'typed' | 'drawn';
  pngBytes: Uint8Array | null;
  typedName: string;
  signedAt: Date;
  /** IANA zone the date is written in -- the jurisdiction's, not the server's. */
  timeZone: string;
  /** Written into the PDF's keywords so the file can be traced back to its signature record. */
  reference: string;
}

// The calendar date in `timeZone`, in the form's own format.
export function formatSignatureDate(date: Date, timeZone: string, format: SignatureDateFormat): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const [year, month, day] = [part('year'), part('month'), part('day')];
  switch (format) {
    case 'mm/dd/yyyy':
      return `${month}/${day}/${year}`;
    case 'dd-mm-yyyy':
      return `${day}-${month}-${year}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

// Province/territory -> the zone its forms are dated in (the most populous
// zone where a province spans more than one).
const PROVINCE_TIME_ZONES: Record<string, string> = {
  BC: 'America/Vancouver',
  AB: 'America/Edmonton',
  SK: 'America/Regina',
  MB: 'America/Winnipeg',
  ON: 'America/Toronto',
  QC: 'America/Toronto',
  NB: 'America/Moncton',
  NS: 'America/Halifax',
  PE: 'America/Halifax',
  NL: 'America/St_Johns',
  YT: 'America/Whitehorse',
  NT: 'America/Yellowknife',
  NU: 'America/Iqaluit',
};

export function provinceTimeZone(provinceCode: string | null | undefined): string {
  return PROVINCE_TIME_ZONES[(provinceCode ?? '').toUpperCase()] ?? 'America/Toronto';
}

const TYPED_SIGNATURE_MAX_FONT_SIZE = 16;
const TYPED_SIGNATURE_MIN_FONT_SIZE = 5;

// The standard fonts only cover WinAnsi, and drawText()/setText() throw on
// anything else; an unencodable character becomes '?' rather than failing
// the signature (same fallback as qp-pdf-layout.ts).
function winAnsiSafe(font: PDFFont, text: string): string {
  const encodable = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text) {
    out += encodable.has(ch.codePointAt(0)!) ? ch : '?';
  }
  return out;
}

function requireTextField(form: PDFForm, name: string) {
  try {
    return form.getTextField(name);
  } catch (err) {
    throw new Error(`Signature slot field "${name}" not found (or not a text field): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stampSignature(input: StampSignatureInput): Promise<Uint8Array> {
  const { slot } = input;
  const pdfDoc = await PDFDocument.load(input.pdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[slot.page - 1];
  if (!page) {
    throw new Error(`Signature slot is on page ${slot.page}, but the document has ${pages.length} page(s).`);
  }

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const printedName = winAnsiSafe(helvetica, input.typedName);
  const signedDate = formatSignatureDate(input.signedAt, input.timeZone, slot.dateFormat);

  if (slot.signaturePdfFieldName || slot.namePdfFieldName || slot.datePdfFieldName) {
    const form = pdfDoc.getForm();
    if (slot.signaturePdfFieldName) {
      const field = form.getFieldMaybe(slot.signaturePdfFieldName);
      if (!field) {
        throw new Error(`Signature slot field "${slot.signaturePdfFieldName}" not found on this document.`);
      }
      form.removeField(field);
    }
    if (slot.namePdfFieldName) {
      requireTextField(form, slot.namePdfFieldName).setText(printedName);
    }
    if (slot.datePdfFieldName) {
      requireTextField(form, slot.datePdfFieldName).setText(signedDate);
    }
  }

  if (slot.nameX !== null && slot.nameY !== null) {
    page.drawText(printedName, { x: slot.nameX, y: slot.nameY, size: OVERLAY_FONT_SIZE, font: helvetica, color: rgb(0, 0, 0) });
  }
  if (slot.dateX !== null && slot.dateY !== null) {
    page.drawText(signedDate, { x: slot.dateX, y: slot.dateY, size: OVERLAY_FONT_SIZE, font: helvetica, color: rgb(0, 0, 0) });
  }

  if (input.method === 'drawn') {
    if (!input.pngBytes) {
      throw new Error('A drawn signature needs its image.');
    }
    const image = await pdfDoc.embedPng(input.pngBytes);
    const scale = Math.min(slot.width / image.width, slot.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    // Left-aligned and sitting on the bottom of the box, like ink on a line.
    page.drawImage(image, { x: slot.x, y: slot.y, width, height });
  } else {
    const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    const signatureText = winAnsiSafe(italic, input.typedName);
    let size = Math.min(TYPED_SIGNATURE_MAX_FONT_SIZE, slot.height * 0.9);
    while (size > TYPED_SIGNATURE_MIN_FONT_SIZE && italic.widthOfTextAtSize(signatureText, size) > slot.width) {
      size -= 0.5;
    }
    const descent = Math.abs(italic.heightAtSize(size, { descender: true }) - italic.heightAtSize(size, { descender: false }));
    page.drawText(signatureText, { x: slot.x, y: slot.y + descent, size, font: italic, color: rgb(0, 0, 0) });
  }

  pdfDoc.setKeywords([`permitfield-esignature:${input.reference}`]);
  return pdfDoc.save();
}
