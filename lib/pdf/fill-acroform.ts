import { PDFDocument } from 'pdf-lib';

// AcroForm field-name-based filling (SS3.7, PHASE_0_FINDINGS.md's Toronto/
// Calgary inspection): for real fillable PDF forms, pdf-lib can look up a
// field by the exact name burned into the PDF at authoring time and set its
// text directly -- no coordinates involved.

export interface AcroFormFillInstruction {
  pdfFieldName: string;
  // null means "leave this field blank" -- lib/pdf/resolve-fields.ts is
  // what decides null vs. a real value (missing data, or below
  // PDF_FILL_MIN_CONFIDENCE); this module has no opinion on why a value is
  // absent, it only fills what it's given.
  value: string | null;
}

export interface AcroFormFillResult {
  filledBytes: Uint8Array;
  filledFieldNames: string[];
}

/**
 * Fills a real AcroForm PDF's text fields by name. A pdf_field_name that
 * doesn't exist on the template (or isn't a text field) throws rather than
 * being silently skipped: permit_form_fields rows are meant to be
 * hand-verified against the actual template (Phase 0's pdf-lib inspection,
 * PHASE_0_FINDINGS.md), so a mismatch here means either the template file
 * changed underneath the seed data or the seed data has a typo -- both are
 * data-integrity bugs that must fail loudly, not produce a silently
 * incomplete government form.
 */
export async function fillAcroForm(
  templateBytes: Uint8Array,
  instructions: AcroFormFillInstruction[]
): Promise<AcroFormFillResult> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const filledFieldNames: string[] = [];

  for (const instruction of instructions) {
    if (instruction.value === null) continue;

    let field;
    try {
      field = form.getTextField(instruction.pdfFieldName);
    } catch (err) {
      throw new Error(
        `AcroForm field "${instruction.pdfFieldName}" not found (or not a text field) on this template: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    field.setText(instruction.value);
    filledFieldNames.push(instruction.pdfFieldName);
  }

  const filledBytes = await pdfDoc.save();
  return { filledBytes, filledFieldNames };
}
