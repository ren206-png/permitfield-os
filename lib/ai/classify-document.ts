import { generateContent } from './gemini/client';
import { routeAiTask } from './router';
import { CLASSIFICATION_MAX_VALIDATION_ATTEMPTS, CLASSIFICATION_PROMPT_VERSION } from './config';
import { DocumentClassificationSchema, type DocumentClassification } from './schemas/classification';

// Gate AI-1, sub-phase AI-1.3 (GATE_AI_1_FINDINGS.md §D/§G). First real
// caller of lib/ai/router.ts's routeAiTask() -- routed to 'classification',
// which resolves to Gemini per that file's TASK_ROUTES. This is deliberately
// scoped to the text-only, single-document case: lib/ai/gemini/client.ts's
// generateContent has no vision/file-input support (that file's own
// header), so this module -- and its Inngest caller,
// lib/inngest/functions/classify-documents.ts -- only ever classifies
// documents that were already routed to the 'text' extraction route by
// lib/pdf/text-density.ts's computeTextDensity(); a scanned/image-only
// document is an honest, documented gap here, not silently mishandled.
//
// The product name must never appear inside a prompt sent to the model (same
// SS0.9 rule extract-permit-data.ts's own header states) -- the model stays
// an anonymous classification step.

const CLASSIFICATION_SYSTEM_PROMPT = `You are assisting in organizing documents submitted for a permit \
application. You are not the authority having jurisdiction and you do not \
determine compliance.

TASK
You will be shown the extracted text of one submitted document. Classify it \
into exactly one of these four categories, based only on what the text \
itself suggests the document is:
- blueprint: an architectural or engineering drawing/plan sheet.
- spec_sheet: a product or material specification sheet (for example, an \
equipment or appliance cut sheet).
- scope_of_work: a written description of the work to be performed.
- other: anything that does not clearly fit the three categories above.

OUTPUT
Reply with ONLY a single JSON object, no markdown formatting and no other \
text, in exactly this shape:
{"doc_kind": "<one of blueprint, spec_sheet, scope_of_work, other>", "confidence": <number between 0 and 1>}

HARD RULES
- confidence must reflect your genuine certainty, not a fixed or rounded \
number -- use low values for ambiguous or low-signal text.
- Do not classify from the filename alone if the extracted text does not \
support that category.
- If the extracted text is too sparse or garbled to classify with any \
confidence, still choose the closest-fitting category, but report a low \
confidence rather than refusing to answer.`;

export interface ClassifyDocumentInput {
  filename: string;
  /** Text-layer content already extracted by computeTextDensity(); never PDF bytes -- see this file's header. */
  textContent: string;
}

export interface ClassifyDocumentResult {
  parsed: DocumentClassification | null;
  structurallyValid: boolean;
  validationErrors: string[];
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  promptVersion: string;
}

function buildUserPrompt(input: ClassifyDocumentInput): string {
  return `Filename: ${input.filename}\n\nDocument text:\n${input.textContent}`;
}

/**
 * Parses a model text response as JSON, tolerating a markdown code fence
 * (```json ... ```) around it -- generateContent has no forced-JSON output,
 * so a text model wrapping its answer in a fence is a real, expected shape
 * to defend against, not a hypothetical one.
 */
function parseJsonResponse(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate);
}

/**
 * Calls Gemini once (via routeAiTask('classification')) to classify a single
 * document's already-extracted text, validates the response, and retries at
 * most once with the validation error appended if it fails -- same
 * retry-once-then-fail-closed policy as extractPermitData/auditPermitData/
 * reviewDrawing (global engineering rule). Never throws on a validation
 * failure -- returns `structurallyValid: false` and lets the caller (the
 * classify-documents Inngest function) decide how to persist that. Does
 * still throw on a genuine API/network error (e.g. GEMINI_API_KEY missing,
 * timeout, non-2xx), which is a different failure mode the caller's own
 * Inngest step retries via its `retries` config, not this function's
 * validation loop.
 */
export async function classifyDocument(input: ClassifyDocumentInput): Promise<ClassifyDocumentResult> {
  if (input.textContent.trim().length === 0) {
    throw new Error('classifyDocument requires non-empty textContent.');
  }

  const { modelId } = routeAiTask('classification');

  let lastRaw: unknown = null;
  let lastErrors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let userPrompt = buildUserPrompt(input);

  for (let attempt = 1; attempt <= CLASSIFICATION_MAX_VALIDATION_ATTEMPTS; attempt++) {
    const response = await generateContent(CLASSIFICATION_SYSTEM_PROMPT, userPrompt, modelId);
    lastRaw = response.raw;
    inputTokens += response.inputTokenCount;
    outputTokens += response.outputTokenCount;

    let candidate: unknown;
    let parseFailed = false;
    try {
      candidate = parseJsonResponse(response.text);
    } catch {
      parseFailed = true;
    }

    if (!parseFailed) {
      const zodResult = DocumentClassificationSchema.safeParse(candidate);
      if (zodResult.success) {
        return {
          parsed: zodResult.data,
          structurallyValid: true,
          validationErrors: [],
          rawResponse: lastRaw,
          inputTokens,
          outputTokens,
          modelId,
          promptVersion: CLASSIFICATION_PROMPT_VERSION,
        };
      }
      lastErrors = zodResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    } else {
      lastErrors = ['Model response was not valid JSON.'];
    }

    if (attempt < CLASSIFICATION_MAX_VALIDATION_ATTEMPTS) {
      userPrompt = `${buildUserPrompt(input)}\n\nYour previous response was invalid: ${lastErrors.join('; ')}. Reply again with ONLY the corrected JSON object, no other text.`;
    }
  }

  // Fail closed: every attempt failed structural validation. The caller
  // persists this as a failed ai_jobs row and leaves
  // application_documents.ai_suggested_doc_kind untouched -- never a
  // partially trusted suggestion (same SS7 adversarial check #6 discipline
  // as extractPermitData's own fail-closed return).
  return {
    parsed: null,
    structurallyValid: false,
    validationErrors: lastErrors,
    rawResponse: lastRaw,
    inputTokens,
    outputTokens,
    modelId,
    promptVersion: CLASSIFICATION_PROMPT_VERSION,
  };
}
