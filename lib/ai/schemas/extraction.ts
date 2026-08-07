import { z } from 'zod';

// Response schema for the `permit.extract` Inngest function
// (lib/inngest/functions/extract.ts). Validated server-side with this exact
// schema before anything touches the database (global engineering rule).
//
// Every field is independently nullable and carries its own confidence and
// provenance (SS4.2) -- there is no bare scalar anywhere in this schema. A
// confidently-wrong license number on a filed permit is worse than a blank
// one (SS4.2), so a low-confidence field must be representable as
// "present but uncertain," not forced into either "known" or "absent."
//
// `source_document_id` is constrained by the caller (lib/ai/extract-permit-data.ts)
// to the set of document IDs actually sent in the request -- the model
// cannot cite a document it wasn't shown, mirroring SS0.2's "no citation, no
// finding" rule for the audit engine.
function extractedField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
    source_document_id: z.string().uuid().nullable(),
    source_page: z.number().int().positive().nullable(),
  });
}

export const PermitExtractionSchema = z.object({
  applicant_name: extractedField(z.string().min(1)),
  license_number: extractedField(z.string().min(1)),
  // Unit is implicit: this MVP's corpus is metric-only (jurisdictions.unit_system,
  // all seed rows are 'metric' -- see supabase/seed.sql), so this is square
  // metres. An imperial jurisdiction would need this field to carry its own
  // unit rather than assuming one, same as SS0.8's measurement-fields rule --
  // out of scope until a US/imperial jurisdiction actually ships.
  square_footage: extractedField(z.number().positive()),
  electrical_amps: extractedField(z.number().positive()),
  // Deliberate deviation from the mission draft's literal field name
  // `estimated_job_value_cents`: the model is never asked to do currency
  // arithmetic. It extracts the amount as printed, verbatim, and
  // lib/money/cents.ts -- a deterministic, float-free function, not the
  // model -- converts it to integer cents after validation. See that file's
  // header comment and SS7 adversarial check #7.
  estimated_job_value_raw: extractedField(z.string().min(1)),
  scope_of_work_summary: extractedField(z.string().min(1)),
});

export type PermitExtraction = z.infer<typeof PermitExtractionSchema>;

export type ExtractedFieldKey = keyof PermitExtraction;
