// Gate AI-1, sub-phase AI-1.1 (GATE_AI_1_FINDINGS.md §G). Zod shapes for the
// three new tables added by
// 20260806000036_ai_jobs_token_ledger_human_reviews.sql. Unlike
// lib/ai/schemas/extraction.ts / audit.ts, these do not validate a model's
// tool-use response -- they validate this codebase's own insert payloads
// before they reach ai_jobs/ai_token_ledger/ai_human_reviews, so a future
// caller gets a type error (or a runtime parse failure in a test) instead of
// a Postgres check-constraint violation being the first place a mismatched
// shape is caught. The enum values below are duplicated from, and must be
// kept in sync with, the Postgres enums in that migration
// (ai_task_kind/ai_provider/ai_job_status/ai_human_review_status) -- there
// is no code-generation step in this repo that derives one from the other,
// same as every other hand-maintained enum pair in lib/ai/schemas/.

import { z } from 'zod';

// Kept in sync with `ai_task_kind` (20260806000036). 'extraction'/'audit'
// are listed for completeness but are REJECTED by lib/ai/router.ts's
// routeAiTask() -- see that file's header for why (GATE_AI_1_FINDINGS.md
// question 2's default: the existing Claude call sites are not routed
// through this table yet).
export const AiTaskKindSchema = z.enum([
  'extraction',
  'audit',
  'assistant',
  'classification',
  'checklist_generation',
]);
export type AiTaskKind = z.infer<typeof AiTaskKindSchema>;

// Kept in sync with `ai_provider` (20260806000036).
export const AiProviderSchema = z.enum(['anthropic', 'gemini', 'voyage']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

// Kept in sync with `ai_job_status` (20260806000036). Terminal states only
// -- see that migration's header for why no in-flight status is modeled.
export const AiJobStatusSchema = z.enum(['succeeded', 'failed']);
export type AiJobStatus = z.infer<typeof AiJobStatusSchema>;

// Kept in sync with `ai_human_review_status` (20260806000036).
export const AiHumanReviewStatusSchema = z.enum(['pending', 'released', 'rejected']);
export type AiHumanReviewStatus = z.infer<typeof AiHumanReviewStatusSchema>;

// Mirrors ai_jobs' column shape. `id`/`created_at` are left to the
// database's own defaults (gen_random_uuid()/now()), same convention as
// every other insert-shape type in this codebase -- callers build this,
// not a full row.
export const AiJobInsertSchema = z
  .object({
    org_id: z.string().uuid(),
    kind: AiTaskKindSchema,
    provider: AiProviderSchema,
    model_id: z.string().min(1),
    status: AiJobStatusSchema,
    input_token_count: z.number().int().nonnegative(),
    output_token_count: z.number().int().nonnegative(),
    error_message: z.string().min(1).nullable(),
    related_entity_type: z.string().min(1).nullable(),
    related_entity_id: z.string().uuid().nullable(),
    requested_by_user_id: z.string().uuid().nullable(),
  })
  // Mirrors the table's `check ((status = 'failed') = (error_message is not
  // null))` constraint -- a caller that gets this wrong should see a Zod
  // error before the insert, not rely on the database to reject it after a
  // round trip.
  .refine((job) => (job.status === 'failed') === (job.error_message !== null), {
    message: "error_message must be set if and only if status is 'failed'",
    path: ['error_message'],
  });
export type AiJobInsert = z.infer<typeof AiJobInsertSchema>;

// Mirrors ai_token_ledger's column shape.
export const AiTokenLedgerInsertSchema = z.object({
  org_id: z.string().uuid(),
  job_id: z.string().uuid(),
  provider: AiProviderSchema,
  model_id: z.string().min(1),
  input_token_count: z.number().int().nonnegative(),
  output_token_count: z.number().int().nonnegative(),
  // Integer USD minor units (cents) -- see the migration's header for the
  // sub-cent-rounds-to-zero limitation this column carries.
  cost_usd_cents: z.number().int().nonnegative(),
});
export type AiTokenLedgerInsert = z.infer<typeof AiTokenLedgerInsertSchema>;

// Mirrors ai_human_reviews' insertable columns only (status/reviewer_user_id/
// notes/decided_at are set at decision time via UPDATE, not at insert --
// see the migration's restricted-update trigger).
export const AiHumanReviewInsertSchema = z.object({
  org_id: z.string().uuid(),
  job_id: z.string().uuid(),
});
export type AiHumanReviewInsert = z.infer<typeof AiHumanReviewInsertSchema>;
