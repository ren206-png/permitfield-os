// Phase 4 config constants, same "one file, never inline at a call site"
// discipline as lib/ai/config.ts.

// SS1 (global rule): no unverified AI-extracted value gets typed onto a
// legal government form. Below this confidence, lib/pdf/resolve-fields.ts
// leaves the field blank instead of filling it -- recorded in
// generated_documents.incomplete_required_fields/incomplete_optional_fields
// so the gap is explicitly surfaced, not silently discoverable only by
// opening the PDF. 0.75 is deliberately higher than any threshold used
// elsewhere in this codebase (the audit engine has no fixed cutoff at all --
// every finding, regardless of confidence, is shown to a human for
// Confirm/Dismiss): a low-confidence AUDIT finding is still reviewed by a
// person before it means anything, but a low-confidence PDF FILL becomes
// text on a document a contractor could file without re-reading it word for
// word. The bar for "safe to auto-type" is set higher than the bar for
// "safe to flag for review."
export const PDF_FILL_MIN_CONFIDENCE = 0.75;

// Font size for coordinate-overlay text (lib/pdf/overlay-coordinates.ts).
// 10pt is a conservative, generally-legible default for a standard-size
// form field; overlay_x/overlay_y are per-field but overlay forms don't
// carry a per-field font size in the schema (permit_form_fields has no such
// column) -- one fixed size for every overlay field is a known simplification,
// documented as a Phase 4 limitation rather than silently varying by field.
export const OVERLAY_FONT_SIZE = 10;

// Gate 4 (Quotes & Payments), Phase A addition: layout constants for
// lib/pdf/estimate-pdf.ts and lib/pdf/invoice-pdf.ts, which -- unlike every
// module above this comment -- generate a brand-new document from scratch
// (PDFDocument.create(), not PDFDocument.load() against an existing
// template), since no government-authored estimate/invoice template exists
// to fill. Kept in this same file rather than a new one, per this file's own
// "one file, never inline at a call site" convention for PDF layout
// constants -- these are a different document *kind* than the permit-form
// overlay/AcroForm constants above, not a different concern.
export const QP_PDF_PAGE_WIDTH = 612; // US Letter, points (72pt/in x 8.5in) -- matches pdf-lib's own PageSizes.Letter[0], spelled out here so this file has no import dependency on that pdf-lib export for a value this module only reads once, at page-creation time.
export const QP_PDF_PAGE_HEIGHT = 792; // US Letter, points (72pt/in x 11in) -- see QP_PDF_PAGE_WIDTH.
export const QP_PDF_MARGIN = 54; // 0.75in margins, a conservative default with no product spec to follow yet.
export const QP_PDF_TITLE_FONT_SIZE = 18;
export const QP_PDF_HEADING_FONT_SIZE = 12;
export const QP_PDF_BODY_FONT_SIZE = 10;
export const QP_PDF_LINE_HEIGHT = 14;
