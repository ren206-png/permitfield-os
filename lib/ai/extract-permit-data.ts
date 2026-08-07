import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_MAX_VALIDATION_ATTEMPTS,
  EXTRACTION_PROMPT_VERSION,
  MODEL_ID,
} from './config';
import { PermitExtractionSchema, type PermitExtraction } from './schemas/extraction';
import type { ExtractionRoute } from '@/lib/pdf/text-density';

// The product name must never appear inside a prompt sent to the model, and
// the model must never refer to itself by it (SS0.9) -- the brand belongs to
// the UI chrome, the model stays an anonymous analysis step. This prevents
// the model adopting an authoritative persona that would conflict with
// SS0.1's "never assert compliance" rule. Do not import lib/brand.ts here.
const EXTRACTION_SYSTEM_PROMPT = `You are assisting in preparing a permit application by extracting \
factual data from documents a contractor submitted. You are not the \
authority having jurisdiction and you do not determine compliance.

INPUTS
You will be shown one or more documents submitted for a permit application. \
Each document is introduced with its document ID before its content.

TASK
Call the record_permit_extraction tool exactly once with the following \
fields, extracted from the documents shown: applicant name, contractor \
license number, project area, electrical service size in amps, estimated \
job value, and a short scope-of-work summary.

HARD RULES
- Every field carries a confidence score from 0 to 1.
- Every field carries the ID of the document it was read from \
(source_document_id) and, if identifiable, the page number. Only cite a \
document ID that was shown to you above -- never invent, guess, or reuse a \
document ID for a fact that document doesn't contain.
- If a field is not present in any shown document, its value is null. A \
missing field is missing information, not a zero and not an assumption.
- Extract the estimated job value exactly as printed on the document \
(currency symbol, thousands separators, and cents included) as a plain \
string. Do not convert it to cents. Do not perform arithmetic on it.
- Do not infer, guess, or complete facts that are not stated in the \
documents.`;

const RECORD_EXTRACTION_TOOL_NAME = 'record_permit_extraction';

const extractionToolInputSchema = z.toJSONSchema(PermitExtractionSchema, {
  target: 'draft-7',
});

export interface ExtractionDocumentInput {
  /** application_documents.id -- the only IDs the model is allowed to cite. */
  id: string;
  filename: string;
  route: ExtractionRoute;
  /** Required when route === 'text'. */
  textContent?: string;
  /** Required when route === 'vision'; raw PDF bytes, base64-encoded. */
  bytesBase64?: string;
}

export interface ExtractPermitDataResult {
  parsed: PermitExtraction | null;
  zodValid: boolean;
  validationErrors: string[];
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  promptVersion: string;
}

function buildDocumentContentBlocks(
  documents: ExtractionDocumentInput[]
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Valid document IDs for citation: ${documents.map((d) => d.id).join(', ')}`,
    },
  ];

  for (const doc of documents) {
    blocks.push({ type: 'text', text: `Document ID: ${doc.id}\nFilename: ${doc.filename}` });
    if (doc.route === 'text') {
      if (!doc.textContent) {
        throw new Error(`Document ${doc.id} is routed 'text' but has no textContent.`);
      }
      blocks.push({ type: 'text', text: doc.textContent });
    } else {
      if (!doc.bytesBase64) {
        throw new Error(`Document ${doc.id} is routed 'vision' but has no bytesBase64.`);
      }
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: doc.bytesBase64 },
        title: doc.filename,
      });
    }
  }

  return blocks;
}

/**
 * Validates that every non-null source_document_id in a parsed extraction
 * actually refers to a document the model was shown. Zod alone can't express
 * this (it's a dynamic, per-call constraint, not a static schema shape) --
 * this is the extraction-side counterpart of SS0.2's "no citation, no
 * finding" rule for the audit engine: the model cannot cite evidence it
 * wasn't given.
 */
function findInvalidSourceCitations(parsed: PermitExtraction, validIds: Set<string>): string[] {
  const errors: string[] = [];
  for (const [fieldName, field] of Object.entries(parsed)) {
    const sourceId = (field as { source_document_id: string | null }).source_document_id;
    if (sourceId !== null && !validIds.has(sourceId)) {
      errors.push(
        `${fieldName}.source_document_id "${sourceId}" does not match any document ID that was shown.`
      );
    }
  }
  return errors;
}

/**
 * Calls the model once to extract structured permit-application data from a
 * set of documents, validates the response, and retries at most once with
 * the validation error appended if it fails (global engineering rule: "Zod
 * schema validation on every AI response ... retry once with the error
 * appended, then fail closed and persist status `failed`, never partial
 * data"). This function never throws on a validation failure -- it returns
 * `zodValid: false` and lets the caller decide how to persist that. It does
 * still throw on a genuine API/network error, which is a different failure
 * mode the caller (Inngest step) should retry via its own infrastructure.
 */
export async function extractPermitData(
  client: Anthropic,
  documents: ExtractionDocumentInput[]
): Promise<ExtractPermitDataResult> {
  if (documents.length === 0) {
    throw new Error('extractPermitData requires at least one document.');
  }

  const validIds = new Set(documents.map((d) => d.id));
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildDocumentContentBlocks(documents) },
  ];

  let lastRaw: Anthropic.Messages.Message | null = null;
  let lastErrors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= EXTRACTION_MAX_VALIDATION_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: EXTRACTION_MAX_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [
        {
          name: RECORD_EXTRACTION_TOOL_NAME,
          description: 'Records the structured data extracted from the shown permit documents.',
          input_schema: extractionToolInputSchema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: RECORD_EXTRACTION_TOOL_NAME },
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
      const zodResult = PermitExtractionSchema.safeParse(toolUseBlock.input);
      if (!zodResult.success) {
        lastErrors = zodResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      } else {
        const citationErrors = findInvalidSourceCitations(zodResult.data, validIds);
        if (citationErrors.length > 0) {
          lastErrors = citationErrors;
        } else {
          return {
            parsed: zodResult.data,
            zodValid: true,
            validationErrors: [],
            rawResponse: lastRaw,
            inputTokens,
            outputTokens,
            modelId: MODEL_ID,
            promptVersion: EXTRACTION_PROMPT_VERSION,
          };
        }
      }
    }

    if (attempt < EXTRACTION_MAX_VALIDATION_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Your previous response was invalid: ${lastErrors.join('; ')}. Call ${RECORD_EXTRACTION_TOOL_NAME} again with a corrected response that fixes exactly this problem.`,
        }
      );
    }
  }

  // Fail closed: every attempt failed validation. The caller persists this
  // as zod_valid=false with parsed_data left null -- never a partially
  // trusted result (SS7 adversarial check #6).
  return {
    parsed: null,
    zodValid: false,
    validationErrors: lastErrors,
    rawResponse: lastRaw,
    inputTokens,
    outputTokens,
    modelId: MODEL_ID,
    promptVersion: EXTRACTION_PROMPT_VERSION,
  };
}
