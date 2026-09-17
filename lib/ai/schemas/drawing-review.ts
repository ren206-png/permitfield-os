import { z } from 'zod';
import { FindingKindSchema, FindingSeveritySchema } from './audit';

// Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K). Response schema for the
// `permit.drawing_review` Inngest function
// (lib/inngest/functions/drawing-review.ts). Mirrors, field for field, the
// drawing_findings table (20260806000045_drawing_review_schema.sql) so a
// validated finding maps onto an insert with no translation gaps -- same
// shape/purpose as lib/ai/schemas/audit.ts's own header comment for
// AuditResponseSchema/AuditFindingSchema, which this file deliberately
// reuses FindingKindSchema/FindingSeveritySchema FROM rather than
// redeclaring: a "passed check" / "missing document" / "code conflict"
// taxonomy and a critical/warning/info severity scale are not specific to
// text-document audits, they apply unchanged to a drawing review (see
// 20260806000045's own header comment for why drawing_findings.kind/severity
// reuse audit_findings' enums instead of near-duplicates).
//
// Unlike AuditFindingSchema, a drawing finding has TWO citation axes, not
// one: code_chunk_id (the rule, same as audit) AND source_page (the visual
// evidence location on the drawing sheet itself -- Gate 5's actual
// "evidence-linked" requirement, per 20260806000045's header). "No citation,
// no finding" (SS0.2) is therefore mirrored as TWO separate .refine()s
// below, restating the table's own two CHECK constraints
// (`check (kind = 'missing_document' or code_chunk_id is not null)`,
// `check (kind = 'missing_document' or source_page is not null)`) --
// defense in depth, same reasoning as AuditFindingSchema's own single
// refine(): a finding that fails either shape can never reach the insert,
// and if it somehow did, the DB would reject it too.

// Normalized bounding box on a drawing sheet page, e.g. {"x":0.12,"y":0.30,
// "width":0.08,"height":0.05} in [0,1] fractions of page width/height --
// same contract 20260806000045's own header comment deferred to this
// sub-phase's Zod schema (rather than a DB CHECK) to decide. Deliberately
// NOT required even when source_page is present (a finding may be
// page-level, with no single region to box) -- optional at the top level in
// DrawingFindingSchema below, not inside this object schema itself.
export const SourceRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export type SourceRegion = z.infer<typeof SourceRegionSchema>;

export const DrawingFindingSchema = z
  .object({
    kind: FindingKindSchema,
    severity: FindingSeveritySchema,
    issue: z.string().min(1),
    action_required: z.string().min(1),
    // Validated further, against the set of chunk IDs actually retrieved and
    // shown to the model this run, by lib/ai/review-drawing.ts -- same
    // dynamic, per-call citation check as AuditFindingSchema's own
    // code_chunk_id field (Zod alone can only check "is this a UUID or
    // null," not "was this ID one we actually showed the model").
    code_chunk_id: z.string().uuid().nullable(),
    // 1-indexed page within the application_document being reviewed,
    // matching drawing_findings.source_page's own CHECK
    // (source_page is null or source_page >= 1).
    source_page: z.number().int().min(1).nullable(),
    source_region: SourceRegionSchema.nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine((finding) => finding.kind === 'missing_document' || finding.code_chunk_id !== null, {
    message: "code_chunk_id is required unless kind is 'missing_document' (SS0.2: no citation, no finding).",
    path: ['code_chunk_id'],
  })
  .refine((finding) => finding.kind === 'missing_document' || finding.source_page !== null, {
    message: "source_page is required unless kind is 'missing_document' (the visual-evidence citation axis).",
    path: ['source_page'],
  });

export type DrawingFinding = z.infer<typeof DrawingFindingSchema>;

// The whole-tool-call shape the model is asked to produce: a flat array of
// findings. Registered as the Anthropic tool's input_schema. Its array items
// intentionally repeat DrawingFindingSchema's fields WITHOUT either
// .refine() -- z.toJSONSchema() can't represent a cross-field refinement,
// and the tool's input_schema only needs to describe shape to the model, not
// enforce the citation rules. Both refinements are applied afterward, per
// element, by re-parsing each item through DrawingFindingSchema in
// lib/ai/review-drawing.ts. Same split as lib/ai/schemas/audit.ts's own
// AuditResponseSchema/AuditFindingSchema.
export const DrawingReviewResponseSchema = z.object({
  findings: z.array(
    z.object({
      kind: FindingKindSchema,
      severity: FindingSeveritySchema,
      issue: z.string().min(1),
      action_required: z.string().min(1),
      code_chunk_id: z.string().uuid().nullable(),
      source_page: z.number().int().min(1).nullable(),
      source_region: SourceRegionSchema.nullable(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export type DrawingReviewResponse = z.infer<typeof DrawingReviewResponseSchema>;
