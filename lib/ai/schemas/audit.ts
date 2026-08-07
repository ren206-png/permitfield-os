import { z } from 'zod';

// Response schema for the `permit.audit` Inngest function
// (lib/inngest/functions/audit.ts). Mirrors, field for field, the
// audit_findings table (supabase/migrations/20260806000009_audits_and_findings.sql)
// so a validated finding maps onto an insert with no translation gaps.
//
// Unlike PermitExtractionSchema (lib/ai/schemas/extraction.ts), which
// validates one object as a single pass/fail unit, an audit response is a
// LIST of largely-independent findings -- lib/ai/audit-permit-data.ts
// validates each finding in the array separately, so one bad citation among
// many good findings gets dropped into ai_findings_rejected instead of
// invalidating the whole batch. AuditFindingSchema below is exported
// specifically so it can be used per-item, not just nested in the array
// schema.

export const FindingKindSchema = z.enum(['passed_check', 'missing_document', 'code_conflict']);
export const FindingSeveritySchema = z.enum(['critical', 'warning', 'info']);

// SS0.2 "no citation, no finding," enforced here as the same DB-level
// constraint (`check (kind = 'missing_document' or code_chunk_id is not
// null)`) restated as a Zod .refine() -- a finding that fails this shape can
// never reach the insert, and if it somehow did, the DB would reject it too.
// Keeping both is deliberate defense in depth, not redundancy: this refine()
// gives a specific, per-item rejection reason for ai_findings_rejected before
// any DB round-trip happens at all.
export const AuditFindingSchema = z
  .object({
    kind: FindingKindSchema,
    severity: FindingSeveritySchema,
    issue: z.string().min(1),
    action_required: z.string().min(1),
    // Validated further, against the set of chunk IDs actually retrieved and
    // shown to the model this run, by lib/ai/audit-permit-data.ts -- Zod
    // alone can only check "is this a UUID or null," not "was this ID one we
    // actually showed the model," which is the dynamic, per-call half of the
    // citation check (same pattern as extraction's findInvalidSourceCitations).
    code_chunk_id: z.string().uuid().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine((finding) => finding.kind === 'missing_document' || finding.code_chunk_id !== null, {
    message: "code_chunk_id is required unless kind is 'missing_document' (SS0.2: no citation, no finding).",
    path: ['code_chunk_id'],
  });

export type AuditFinding = z.infer<typeof AuditFindingSchema>;

// The whole-tool-call shape the model is asked to produce: a flat array of
// findings. This wrapper schema is what's registered as the Anthropic tool's
// input_schema. Its array items intentionally repeat AuditFindingSchema's
// fields WITHOUT the .refine() -- z.toJSONSchema() can't represent a
// cross-field refinement, and the tool's input_schema only needs to describe
// shape to the model, not enforce the citation rule. The refinement is
// applied afterward, per element, by re-parsing each item through
// AuditFindingSchema in lib/ai/audit-permit-data.ts.
export const AuditResponseSchema = z.object({
  findings: z.array(
    z.object({
      kind: FindingKindSchema,
      severity: FindingSeveritySchema,
      issue: z.string().min(1),
      action_required: z.string().min(1),
      code_chunk_id: z.string().uuid().nullable(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export type AuditResponse = z.infer<typeof AuditResponseSchema>;
