import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AUDIT_MAX_TOKENS, AUDIT_MAX_VALIDATION_ATTEMPTS, AUDIT_PROMPT_VERSION, MODEL_ID } from './config';
import { AuditFindingSchema, AuditResponseSchema, type AuditFinding, type AuditResponse } from './schemas/audit';
import type { PermitExtraction } from './schemas/extraction';
import type { RetrievedCodeChunk } from './retrieve-code-chunks';

// This module produces ONLY 'passed_check' and 'code_conflict' findings.
// 'missing_document' findings are computed deterministically elsewhere
// (lib/inngest/functions/audit.ts, comparing permit_types.compliance_rules
// against the application's actual application_documents.doc_kind values)
// per SS4.3: "compliance_rules is checked in application code, not by the
// AI." The model is never shown compliance_rules and is explicitly told not
// to produce that finding kind -- there is nothing for it to cite for an
// absent document anyway (SS0.2), so asking it to reason about missing
// documents would only invite a null-citation finding.
//
// The product name must never appear inside a prompt sent to the model (SS0.9)
// -- same rule as lib/ai/extract-permit-data.ts. Do not import lib/brand.ts here.
const AUDIT_SYSTEM_PROMPT = `You are assisting in preparing a permit application by comparing facts \
already extracted from a contractor's submitted documents against excerpts \
from the applicable jurisdiction's published code and permitting \
requirements. You are not the authority having jurisdiction, you do not \
determine legal compliance, and your output is reviewed by a licensed \
professional before it is relied on.

INPUTS
You will be shown the extracted application facts, then one or more code \
excerpts. Each excerpt is introduced with its chunk ID before its content.

TASK
Call the record_audit_findings tool exactly once with a list of findings. \
For each applicable code excerpt, either:
- note that the extracted facts appear consistent with it (kind "passed_check"), or
- note a possible conflict between the extracted facts and it (kind "code_conflict").

HARD RULES
- Every finding cites the ID of exactly one code excerpt it is based on \
(code_chunk_id). Only cite an ID that was shown to you above -- never \
invent, guess, or reuse an ID for a finding it doesn't support.
- Never use the finding kind "missing_document" -- that determination is \
made by other code, not by you.
- Every finding carries a confidence score from 0 to 1.
- severity is "critical" for a conflict that would likely block the permit, \
"warning" for one that needs the contractor's attention but may not block \
it, and "info" for a passed_check or a minor note.
- issue is a short factual statement of what you observed; action_required \
is the concrete next step recommended for the contractor.
- Do not invent, guess, or complete facts that are not in what you were \
shown. If no excerpt is relevant to a fact, do not force a finding for it.
- If none of the shown excerpts are relevant, call the tool with an empty \
findings list rather than fabricating one.`;

const RECORD_AUDIT_TOOL_NAME = 'record_audit_findings';

const auditToolInputSchema = z.toJSONSchema(AuditResponseSchema, { target: 'draft-7' });

export interface RejectedFinding {
  rawFinding: unknown;
  reason: string;
}

export interface AuditPermitDataResult {
  /** Findings that passed both Zod shape validation and the citation check. */
  findings: AuditFinding[];
  /** Findings dropped for a bad citation or invalid kind -- persisted by the
   *  caller into ai_findings_rejected (SS6 citation-validity-rate metric),
   *  never silently discarded. */
  rejected: RejectedFinding[];
  /** false only when every attempt failed to even produce a structurally
   *  valid findings array -- the caller must fail the whole audit closed in
   *  that case (never insert an audits row implying "we checked, all
   *  clear"). */
  structurallyValid: boolean;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  promptVersion: string;
}

function formatExtractionFacts(extraction: PermitExtraction): string {
  const lines: string[] = [];
  if (extraction.scope_of_work_summary.value) {
    lines.push(`Scope of work: ${extraction.scope_of_work_summary.value}`);
  }
  if (extraction.square_footage.value !== null) {
    lines.push(`Project area: ${extraction.square_footage.value} square metres`);
  }
  if (extraction.electrical_amps.value !== null) {
    lines.push(`Electrical service size: ${extraction.electrical_amps.value} amps`);
  }
  if (extraction.license_number.value) {
    lines.push(`Contractor license number: ${extraction.license_number.value}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(No extracted facts are available for this application.)';
}

function buildContentBlocks(
  extraction: PermitExtraction,
  chunks: RetrievedCodeChunk[]
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'text', text: `Extracted application facts:\n${formatExtractionFacts(extraction)}` },
    { type: 'text', text: `Valid code excerpt IDs for citation: ${chunks.map((c) => c.id).join(', ')}` },
  ];

  for (const chunk of chunks) {
    blocks.push({
      type: 'text',
      text: `Chunk ID: ${chunk.id}\nSection: ${chunk.codeSection}\nSource: ${chunk.sourceUrl}\n\n${chunk.content}`,
    });
  }

  return blocks;
}

/**
 * Calls the model once to compare already-extracted application facts
 * against retrieved code excerpts, then validates the response in two
 * distinct passes (see AUDIT_MAX_VALIDATION_ATTEMPTS's comment in
 * lib/ai/config.ts for why they're split):
 *
 * 1. Whole-call structural validation (AuditResponseSchema): retried up to
 *    AUDIT_MAX_VALIDATION_ATTEMPTS times, exactly like extractPermitData.
 *    Fails closed (structurallyValid: false, no findings at all) if every
 *    attempt is structurally malformed.
 * 2. Per-item validation (AuditFindingSchema's citation + kind refine, run
 *    once against whatever structurally-valid array came back): a single
 *    bad finding is dropped into `rejected` with a reason, everything else
 *    in the same array is still returned as valid. This never triggers a
 *    retry -- re-asking the model to "fix" one bad citation among many good
 *    findings risks it fabricating a different plausible-looking citation
 *    rather than admitting uncertainty.
 */
export async function auditPermitData(
  client: Anthropic,
  extraction: PermitExtraction,
  retrievedChunks: RetrievedCodeChunk[]
): Promise<AuditPermitDataResult> {
  // No chunks were retrieved (guaranteed today: no ingestion pipeline has
  // populated jurisdiction_code_chunks in any phase yet) -- there is nothing
  // the model could possibly cite, so skip the call entirely rather than
  // spend a request on a guaranteed-empty result. This is a real, expected
  // steady state pre-ingestion, not an error.
  if (retrievedChunks.length === 0) {
    return {
      findings: [],
      rejected: [],
      structurallyValid: true,
      rawResponse: null,
      inputTokens: 0,
      outputTokens: 0,
      modelId: MODEL_ID,
      promptVersion: AUDIT_PROMPT_VERSION,
    };
  }

  const validChunkIds = new Set(retrievedChunks.map((c) => c.id));
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildContentBlocks(extraction, retrievedChunks) },
  ];

  let lastRaw: Anthropic.Messages.Message | null = null;
  let lastErrors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= AUDIT_MAX_VALIDATION_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: AUDIT_MAX_TOKENS,
      system: AUDIT_SYSTEM_PROMPT,
      tools: [
        {
          name: RECORD_AUDIT_TOOL_NAME,
          description: 'Records the audit findings comparing extracted application facts to shown code excerpts.',
          input_schema: auditToolInputSchema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: RECORD_AUDIT_TOOL_NAME },
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
      const zodResult = AuditResponseSchema.safeParse(toolUseBlock.input);
      if (!zodResult.success) {
        lastErrors = zodResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      } else {
        // Structurally valid array -- now validate each finding
        // independently. This is a terminal return, not a retry branch.
        const findings: AuditFinding[] = [];
        const rejected: RejectedFinding[] = [];

        for (const rawFinding of zodResult.data.findings) {
          const result = validateAuditFindingItem(rawFinding, validChunkIds);
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
          promptVersion: AUDIT_PROMPT_VERSION,
        };
      }
    }

    if (attempt < AUDIT_MAX_VALIDATION_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Your previous response was invalid: ${lastErrors.join('; ')}. Call ${RECORD_AUDIT_TOOL_NAME} again with a corrected response that fixes exactly this problem.`,
        }
      );
    }
  }

  // Fail closed: every attempt failed structural validation. The caller must
  // treat this the same as extractPermitData's zodValid=false case -- never
  // insert an audits row implying a clean or partial result.
  return {
    findings: [],
    rejected: [],
    structurallyValid: false,
    rawResponse: lastRaw,
    inputTokens,
    outputTokens,
    modelId: MODEL_ID,
    promptVersion: AUDIT_PROMPT_VERSION,
  };
}

export type AuditFindingValidationResult = { ok: true; finding: AuditFinding } | { ok: false; reason: string };

/**
 * The per-item half of audit response validation (citation membership +
 * forbidden-kind + Zod shape), extracted as its own exported function so
 * eval/run.ts's offline citation/schema check (todo: "offline unit check of
 * citation/Zod validation logic") exercises this EXACT production code path
 * instead of a parallel reimplementation that could silently drift out of
 * sync with it. See auditPermitData's doc comment for why a single bad item
 * here never triggers a whole-batch retry.
 */
export function validateAuditFindingItem(
  rawFinding: AuditResponse['findings'][number],
  validChunkIds: Set<string>
): AuditFindingValidationResult {
  if (rawFinding.kind === 'missing_document') {
    return {
      ok: false,
      reason: "Model produced a 'missing_document' finding; that kind is determined deterministically, not by the model.",
    };
  }
  if (rawFinding.code_chunk_id !== null && !validChunkIds.has(rawFinding.code_chunk_id)) {
    return {
      ok: false,
      reason: `code_chunk_id "${rawFinding.code_chunk_id}" does not match any code excerpt that was shown.`,
    };
  }

  const itemResult = AuditFindingSchema.safeParse(rawFinding);
  if (!itemResult.success) {
    return {
      ok: false,
      reason: itemResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    };
  }

  return { ok: true, finding: itemResult.data };
}
