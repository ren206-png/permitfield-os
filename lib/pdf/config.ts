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
