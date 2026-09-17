import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  DRAWING_REVIEW_MAX_TOKENS,
  DRAWING_REVIEW_MAX_VALIDATION_ATTEMPTS,
  DRAWING_REVIEW_PROMPT_VERSION,
  MODEL_ID,
} from './config';
import {
  DrawingFindingSchema,
  DrawingReviewResponseSchema,
  type DrawingFinding,
  type DrawingReviewResponse,
} from './schemas/drawing-review';
import type { ExtractionDocumentInput } from './extract-permit-data';
import type { RetrievedCodeChunk } from './retrieve-code-chunks';
import type { RejectedFinding } from './audit-permit-data';

// Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K). Reviews a single uploaded
// drawing/blueprint document (ExtractionDocumentInput -- reused directly
// from lib/ai/extract-permit-data.ts rather than inventing a near-duplicate
// type, since a drawing IS exactly "one document, already downloaded and
// text/vision-routed") against retrieved jurisdiction code excerpts,
// producing citable drawing_findings. Architecturally the same shape as
// lib/ai/audit-permit-data.ts -- vision-or-text document input, tool-use
// call, two-pass validation (whole-call structural, then per-item
// citation) -- reused rather than reinvented, per GATE_5_FINDINGS.md §I.1
// Q2's resolution that drawing review stays on Claude directly (see
// 20260806000045_drawing_review_schema.sql's own header comment on why
// 'drawing_review' is not added to lib/ai/router.ts's TASK_ROUTES).
//
// SCOPE DECISION: unlike auditPermitData, this module's system prompt
// forbids the model from producing a 'missing_document' finding at all (not
// just re-labels it as deterministic elsewhere) -- there is no
// drawing-review equivalent of audit's computeMissingDocumentFindings
// (compliance_rules vs. uploaded doc_kind) in this sub-phase, so there is
// nothing to deterministically compute a missing_document finding FROM yet.
// The 'missing_document' kind, and DrawingFindingSchema's own exemption of
// it from both citation requirements, are kept in the schema regardless
// (same "declared ahead of its consumer" discipline as
// drawing_category/jurisdiction_code_chunks -- 20260806000045's own header
// comment) so a future sub-phase that adds a real deterministic missing-
// document check for drawings does not need a schema change to use it.
// validateDrawingFindingItem below rejects a model-produced
// 'missing_document' finding the same way validateAuditFindingItem does.
//
// The product name must never appear inside a prompt sent to the model
// (SS0.9) -- same rule as lib/ai/extract-permit-data.ts /
// lib/ai/audit-permit-data.ts. Do not import lib/brand.ts here.
const DRAWING_REVIEW_SYSTEM_PROMPT = `You are assisting in preparing a permit application by comparing a \
submitted drawing or blueprint document against excerpts from the \
applicable jurisdiction's published code and permitting requirements. You \
are not the authority having jurisdiction, you do not determine legal \
compliance, and your output is reviewed by a licensed professional before \
it is relied on.

INPUTS
You will be shown one drawing document, then one or more code excerpts. \
Each excerpt is introduced with its chunk ID before its content.

TASK
Call the record_drawing_review_findings tool exactly once with a list of \
findings. For each applicable code excerpt, either:
- note that the drawing appears consistent with it (kind "passed_check"), or
- note a possible conflict between what the drawing shows and it (kind "code_conflict").

HARD RULES
- Every finding cites the ID of exactly one code excerpt it is based on \
(code_chunk_id). Only cite an ID that was shown to you above -- never \
invent, guess, or reuse an ID for a finding it doesn't support.
- Every finding also cites the 1-indexed page of the drawing document where \
the relevant evidence appears (source_page). Only cite a page that actually \
exists in the shown document.
- You may optionally include source_region, a bounding box on that page \
({"x","y","width","height"}, each a fraction from 0 to 1 of the page's \
width/height, x/y measured from the top-left corner) pointing at the \
specific detail your finding is based on. Omit it if no single region \
captures the finding (e.g. a page-level observation).
- Never use the finding kind "missing_document" -- that determination is \
made by other code, not by you.
- Every finding carries a confidence score from 0 to 1.
- severity is "critical" for a conflict that would likely block the permit, \
"warning" for one that needs the contractor's attention but may not block \
it, and "info" for a passed_check or a minor note.
- issue is a short factual statement of what you observed; action_required \
is the concrete next step recommended for the contractor.
- Do not invent, guess, or complete facts that are not shown in the \
drawing. If no excerpt is relevant to what the drawing shows, do not force \
a finding for it.
- If none of the shown excerpts are relevant, call the tool with an empty \
findings list rather than fabricating one.`;

const RECORD_DRAWING_REVIEW_TOOL_NAME = 'record_drawing_review_findings';

const drawingReviewToolInputSchema = z.toJSONSchema(DrawingReviewResponseSchema, { target: 'draft-7' });

export interface ReviewDrawingResult {
  /** Findings that passed both Zod shape validation and both citation checks. */
  findings: DrawingFinding[];
  /** Findings dropped for a bad citation, invalid kind, or invalid shape --
   *  persisted by the caller into drawing_findings_rejected (SS6
   *  citation-validity-rate metric, mirrored for this pipeline), never
   *  silently discarded. */
  rejected: RejectedFinding[];
  /** false only when every attempt failed to even produce a structurally
   *  valid findings array -- the caller must fail the whole review closed
   *  in that case (never insert a drawing_reviews row implying "we checked,
   *  all clear"). */
  structurallyValid: boolean;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  promptVersion: string;
}

function buildContentBlocks(
  document: ExtractionDocumentInput,
  chunks: RetrievedCodeChunk[]
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'text', text: `Drawing document filename: ${document.filename}` },
  ];

  if (document.route === 'text') {
    if (!document.textContent) {
      throw new Error(`Document ${document.id} is routed 'text' but has no textContent.`);
    }
    blocks.push({ type: 'text', text: document.textContent });
  } else {
    if (!document.bytesBase64) {
      throw new Error(`Document ${document.id} is routed 'vision' but has no bytesBase64.`);
    }
    blocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: document.bytesBase64 },
      title: document.filename,
    });
  }

  blocks.push({ type: 'text', text: `Valid code excerpt IDs for citation: ${chunks.map((c) => c.id).join(', ')}` });

  for (const chunk of chunks) {
    blocks.push({
      type: 'text',
      text: `Chunk ID: ${chunk.id}\nSection: ${chunk.codeSection}\nSource: ${chunk.sourceUrl}\n\n${chunk.content}`,
    });
  }

  return blocks;
}

/**
 * Calls the model once to compare one drawing document against retrieved
 * code excerpts, then validates the response in two distinct passes -- same
 * split, and same reasoning, as auditPermitData's own doc comment:
 *
 * 1. Whole-call structural validation (DrawingReviewResponseSchema):
 *    retried up to DRAWING_REVIEW_MAX_VALIDATION_ATTEMPTS times. Fails
 *    closed (structurallyValid: false, no findings at all) if every attempt
 *    is structurally malformed.
 * 2. Per-item validation (DrawingFindingSchema's two citation refines + kind
 *    check, run once against whatever structurally-valid array came back):
 *    a single bad finding is dropped into `rejected` with a reason,
 *    everything else in the same array is still returned as valid. This
 *    never triggers a retry, for the identical "don't invite a different
 *    fabricated citation" reasoning given in auditPermitData.
 */
export async function reviewDrawing(
  client: Anthropic,
  document: ExtractionDocumentInput,
  retrievedChunks: RetrievedCodeChunk[]
): Promise<ReviewDrawingResult> {
  // No chunks were retrieved -- there is nothing the model could possibly
  // cite, so skip the call entirely rather than spend a request on a
  // guaranteed-empty result. Same real, expected pre-ingestion steady state
  // as auditPermitData's own zero-chunk short-circuit.
  if (retrievedChunks.length === 0) {
    return {
      findings: [],
      rejected: [],
      structurallyValid: true,
      rawResponse: null,
      inputTokens: 0,
      outputTokens: 0,
      modelId: MODEL_ID,
      promptVersion: DRAWING_REVIEW_PROMPT_VERSION,
    };
  }

  const validChunkIds = new Set(retrievedChunks.map((c) => c.id));
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildContentBlocks(document, retrievedChunks) },
  ];

  let lastRaw: Anthropic.Messages.Message | null = null;
  let lastErrors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= DRAWING_REVIEW_MAX_VALIDATION_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: DRAWING_REVIEW_MAX_TOKENS,
      system: DRAWING_REVIEW_SYSTEM_PROMPT,
      tools: [
        {
          name: RECORD_DRAWING_REVIEW_TOOL_NAME,
          description: 'Records the findings comparing a drawing document to shown code excerpts.',
          input_schema: drawingReviewToolInputSchema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: RECORD_DRAWING_REVIEW_TOOL_NAME },
      messages,
    });

    lastRaw = response;
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      lastErrors = ['Model response contained no tool_use block.'];
    } else {
      const zodResult = DrawingReviewResponseSchema.safeParse(toolUseBlock.input);
      if (!zodResult.success) {
        lastErrors = zodResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      } else {
        // Structurally valid array -- now validate each finding
        // independently. This is a terminal return, not a retry branch.
        const findings: DrawingFinding[] = [];
        const rejected: RejectedFinding[] = [];

        for (const rawFinding of zodResult.data.findings) {
          const result = validateDrawingFindingItem(rawFinding, validChunkIds);
          if (result.ok) {
            findings.push(result.finding);
          } else {
            rejected.push({ rawFinding, reason: result.reason });
          }
        }

        return {
          findings,
          rejected,
          structurallyValid: true,
          rawResponse: lastRaw,
          inputTokens,
          outputTokens,
          modelId: MODEL_ID,
          promptVersion: DRAWING_REVIEW_PROMPT_VERSION,
        };
      }
    }

    if (attempt < DRAWING_REVIEW_MAX_VALIDATION_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Your previous response was invalid: ${lastErrors.join('; ')}. Call ${RECORD_DRAWING_REVIEW_TOOL_NAME} again with a corrected response that fixes exactly this problem.`,
        }
      );
    }
  }

  // Fail closed: every attempt failed structural validation. The caller
  // must never insert a drawing_reviews row implying a clean or partial
  // result.
  return {
    findings: [],
    rejected: [],
    structurallyValid: false,
    rawResponse: lastRaw,
    inputTokens,
    outputTokens,
    modelId: MODEL_ID,
    promptVersion: DRAWING_REVIEW_PROMPT_VERSION,
  };
}

export type DrawingFindingValidationResult = { ok: true; finding: DrawingFinding } | { ok: false; reason: string };

/**
 * The per-item half of drawing-review response validation (citation
 * membership on both axes + forbidden-kind + Zod shape), extracted as its
 * own exported function so eval/run.ts's offline check exercises this EXACT
 * production code path instead of a parallel reimplementation that could
 * silently drift out of sync with it -- same reasoning as
 * validateAuditFindingItem's own doc comment. See reviewDrawing's doc
 * comment for why a single bad item here never triggers a whole-batch
 * retry.
 */
export function validateDrawingFindingItem(
  rawFinding: DrawingReviewResponse['findings'][number],
  validChunkIds: Set<string>
): DrawingFindingValidationResult {
  if (rawFinding.kind === 'missing_document') {
    return {
      ok: false,
      reason:
        "Model produced a 'missing_document' finding; that kind is determined deterministically, not by the model (no such deterministic check exists for drawing review yet).",
    };
  }
  if (rawFinding.code_chunk_id !== null && !validChunkIds.has(rawFinding.code_chunk_id)) {
    return {
      ok: false,
      reason: `code_chunk_id "${rawFinding.code_chunk_id}" does not match any code excerpt that was shown.`,
    };
  }

  const itemResult = DrawingFindingSchema.safeParse(rawFinding);
  if (!itemResult.success) {
    return {
      ok: false,
      reason: itemResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    };
  }

  return { ok: true, finding: itemResult.data };
}
