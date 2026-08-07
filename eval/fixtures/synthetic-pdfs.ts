import { PDFDocument, StandardFonts } from 'pdf-lib';

// Synthetic, test-only PDF fixtures for exercising lib/pdf/fill-acroform.ts
// and lib/pdf/overlay-coordinates.ts end-to-end (eval/run.ts). Built from
// scratch, in memory, at eval-run time -- these are NOT real government
// forms and must never be confused with one. seed.sql deliberately seeds
// zero real overlay_x/overlay_y coordinates for ESA/Calgary because
// fabricating plausible-looking pixel coordinates for an actual government
// form without measuring them would misrepresent unverified data as
// verified; these fixtures sidestep that problem entirely by not claiming
// to be any real form at all -- they exist only to prove fill-acroform.ts's
// and overlay-coordinates.ts's own filling/error-handling logic works
// against a real pdf-lib document, independent of whether any particular
// real template's coordinates have been measured yet.

export async function buildSyntheticAcroFormPdf(fieldNames: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form = pdfDoc.getForm();
  fieldNames.forEach((name, i) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 50, y: 700 - i * 40, width: 200, height: 20, font });
  });
  return pdfDoc.save();
}

export async function buildSyntheticBlankPdf(pageCount: number): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdfDoc.addPage([600, 800]);
  }
  return pdfDoc.save();
}
