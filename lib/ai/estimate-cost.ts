// Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K).
// *** PROVISIONAL, NOT CONFIRMED. *** Same unresolved-source-of-truth gap
// lib/ai/config.ts's own header comment documents for
// GEMINI_ASSISTANT_MODEL_ID/GEMINI_CLASSIFICATION_MODEL_ID:
// PERMITFIELD_AI_MODEL_DECISION.md -- the prompt's own named source of truth
// for every model/pricing decision in this workstream -- does not exist
// anywhere in this repo. These two per-million-token USD rates are
// placeholders, not a ratified price list, using Claude Sonnet's publicly
// published per-token pricing as of this sub-phase as a reasonable
// order-of-magnitude stand-in. Nothing depends on these being final:
// isDrawingReviewEnabled() defaults OFF, and ai_token_ledger.cost_usd_cents
// is documented (20260806000036's own header comment) as "a rounded
// convenience aggregate, not the sole source of truth for spend" -- the raw
// input_token_count/output_token_count persisted alongside it on the same
// row are what let an exact cost be recomputed later once real, confirmed
// rates exist. Changing these two constants before that happens is a
// one-file change, not a rewrite.
const PLACEHOLDER_INPUT_USD_PER_MILLION_TOKENS = 3;
const PLACEHOLDER_OUTPUT_USD_PER_MILLION_TOKENS = 15;

/**
 * Converts a model call's raw token counts into integer USD cents, using the
 * placeholder per-million-token rates above. Per ai_token_ledger's own
 * documented limitation (20260806000036's header comment), a single
 * low-volume call frequently costs a small fraction of one cent -- this
 * function rounds to the nearest cent (never negative, never fractional)
 * rather than floors, so a call that's e.g. half a cent doesn't
 * systematically under-report; the raw token counts persisted alongside this
 * value on the same ai_token_ledger row remain the full-precision source of
 * truth regardless of which rounding rule this function uses.
 */
// Gate 6.7: published per-million-token rates for the models PermitField
// calls (Anthropic price list, 2026-10). A model not listed here falls back
// to the placeholder rates above, which are higher than any listed model,
// so an unknown model is over- rather than under-counted against the caps.
const MODEL_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function estimateCostUsdCents(inputTokenCount: number, outputTokenCount: number, modelId?: string): number {
  if (inputTokenCount < 0 || outputTokenCount < 0) {
    throw new Error(
      `estimateCostUsdCents requires nonnegative token counts, got input=${inputTokenCount}, output=${outputTokenCount}`
    );
  }

  const rates = (modelId && MODEL_USD_PER_MILLION_TOKENS[modelId]) || {
    input: PLACEHOLDER_INPUT_USD_PER_MILLION_TOKENS,
    output: PLACEHOLDER_OUTPUT_USD_PER_MILLION_TOKENS,
  };
  const inputUsd = (inputTokenCount / 1_000_000) * rates.input;
  const outputUsd = (outputTokenCount / 1_000_000) * rates.output;
  return Math.round((inputUsd + outputUsd) * 100);
}
