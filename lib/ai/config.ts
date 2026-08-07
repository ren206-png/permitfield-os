// Single source of truth for the model ID used by every AI call in this
// system (SS2) -- never inline a model string at a call site, so a model
// upgrade or rollback is a one-file change, not a grep-and-replace.
//
// `claude-3-5-sonnet` is NOT a valid model ID for this project -- that
// generation is long superseded. This is `claude-sonnet-5`, per the mission
// spec (SS2), and nothing else.
export const MODEL_ID = 'claude-sonnet-5';

// Bumped whenever the extraction prompt text or its response schema changes.
// Persisted with every `extractions` row (extractions.prompt_version) so a
// bad prompt revision can be identified -- and the exact rows it produced
// found -- without guessing.
export const EXTRACTION_PROMPT_VERSION = 'extraction-v1';

// Same purpose as EXTRACTION_PROMPT_VERSION, for the audit prompt (Phase 3).
// Declared here now so both phases share one place to look for prompt
// versions, even though the audit prompt itself doesn't exist until Phase 3.
export const AUDIT_PROMPT_VERSION = 'audit-v1';

// Structured-output responses can be truncated by a low cap (SS7 adversarial
// check #6: "the truncated response"). This is generous for a single
// permit-application extraction across a handful of documents.
export const EXTRACTION_MAX_TOKENS = 4096;

// A schema-invalid response is retried exactly once, with the validation
// error appended to the prompt, then fails closed (global engineering rule).
// Not a general-purpose retry-on-error count -- network/5xx errors are the
// Anthropic SDK's own retry problem, this is specifically about a
// structurally invalid model response.
export const EXTRACTION_MAX_VALIDATION_ATTEMPTS = 2;

// Phase 3: the audit response is a list of findings (potentially several per
// document/compliance-rule), so it gets its own, larger cap than a single
// extraction object.
export const AUDIT_MAX_TOKENS = 8192;

// Same retry-once-then-fail-closed policy as extraction, applied at the
// whole-tool-call level (a structurally malformed `findings` array). Per-item
// citation/Zod failures within an otherwise-valid array are NOT retried here
// -- they're dropped into `ai_findings_rejected` individually instead, since
// re-asking the model to "fix" one bad citation among many valid findings
// risks it fabricating a different plausible-looking one rather than
// admitting uncertainty.
export const AUDIT_MAX_VALIDATION_ATTEMPTS = 2;

// Embeddings provider (PHASE_0_FINDINGS.md SS5): Anthropic serves no
// embeddings endpoint, so retrieval's vector half uses Voyage AI. voyage-3 /
// 1024 dims was flagged there as an assumption, not a confirmed final call --
// jurisdiction_code_chunks.embedding is declared vector(1024) to match
// (migration 20260806000008). Changing provider/dims before real corpus
// ingestion starts is a migration, not a rewrite.
export const EMBEDDING_MODEL_ID = 'voyage-3';
export const EMBEDDING_DIMENSIONS = 1024;

// How many retrieved code chunks are shown to the audit model per run.
// Bounded for the same reason document counts are bounded in extraction --
// an unbounded context both costs more and gives the model more surface area
// to cite something it wasn't actually shown carefully.
export const AUDIT_MAX_RETRIEVED_CHUNKS = 8;
