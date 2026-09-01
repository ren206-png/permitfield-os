// Gate AI-1, sub-phase AI-1.1 (GATE_AI_1_FINDINGS.md §A/§G). Thin REST
// client for the Gemini API, following lib/ai/embed.ts's existing precedent
// for a secondary provider in this codebase: no SDK is installed for
// Gemini (confirmed via package.json -- `grep -rl "gemini\|Gemini"`
// returned zero matches anywhere outside this workstream's own text before
// this file existed), and a single JSON POST doesn't justify adding one,
// same reasoning lib/ai/embed.ts's own header gives for Voyage.
//
// KEY BOUNDARY: this is the only module in the repo permitted to read
// GEMINI_API_KEY, enforced by eslint.config.mjs's geminiClientRestriction
// (a no-restricted-imports rule, same mechanism and shape as that file's
// pre-existing clientPortalServiceClientRestriction) -- only
// lib/ai/router.ts and this module's own test file may import it. This is
// AI-1.1's answer to the KEY_LEAK adversarial scenario
// (GATE_AI_1_FINDINGS.md §H): a lint-enforced boundary, not just a
// convention, from this module's first commit -- unlike the existing
// Anthropic client, which has no lint-level defense today (only the
// convention that lib/ai/*.ts is never imported from app/**).
//
// ZERO LIVE CALL SITES as of this sub-phase. lib/ai/router.ts imports this
// module but nothing calls routeAiTask() yet -- see that file's header.
// extract-permit-data.ts/audit-permit-data.ts are deliberately untouched
// (GATE_AI_1_FINDINGS.md question 2's default).

import { GEMINI_ASSISTANT_MODEL_ID } from '../config';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiGenerateContentResult {
  text: string;
  inputTokenCount: number;
  outputTokenCount: number;
  /** Raw response body, kept for the same reason extractions/audits persist
   *  raw_response -- a durable record of exactly what the provider returned,
   *  independent of how this wrapper chose to parse it. */
  raw: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/**
 * Calls Gemini's generateContent endpoint with a single system + user text
 * turn. Deliberately minimal (no tool-use / forced-JSON support yet) --
 * AI-1.1 ships the adapter shape, not a port of extract-permit-data.ts's
 * forced tool-use pattern; a future sub-phase that actually routes a task
 * through this client is responsible for its own structured-output/Zod
 * validation and fail-closed retry logic, mirroring
 * lib/ai/extract-permit-data.ts's PARTIAL_JSON defense
 * (GATE_AI_1_FINDINGS.md §H) rather than trusting this wrapper to provide
 * it.
 *
 * Throws on any transport/API error, or when the response contains no
 * candidate text -- fails closed rather than returning an empty string a
 * caller might mistake for a valid (if unhelpful) answer.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  modelId: string = GEMINI_ASSISTANT_MODEL_ID
): Promise<GeminiGenerateContentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set; cannot call the Gemini API.');
  }
  if (userPrompt.trim().length === 0) {
    throw new Error('generateContent requires a non-empty userPrompt.');
  }

  const response = await fetch(
    `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelId)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(`Gemini generateContent API returned ${response.status}: ${body}`);
  }

  const parsed = (await response.json()) as GeminiGenerateContentResponse;
  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) {
    throw new Error('Gemini generateContent API response contained no candidate text.');
  }

  return {
    text,
    inputTokenCount: parsed.usageMetadata?.promptTokenCount ?? 0,
    outputTokenCount: parsed.usageMetadata?.candidatesTokenCount ?? 0,
    raw: parsed,
  };
}
