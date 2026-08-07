// Feature flags (global engineering rule: every new capability ships
// default-OFF). Each flag reads its own PERMITFIELD_FF_* env var fresh on
// every call rather than being cached at module load -- so a flag can be
// flipped in a running environment (e.g. a platform that injects env vars
// per-request) without a redeploy, and so eval/run.ts can flip one in
// process before importing the functions that read it.
//
// Absence, "false", "0", "", or any value other than the literal string
// "true" all resolve to OFF -- there is no implicit-ON parsing of env vars
// here, since a typo'd or unset flag must fail toward the safer (disabled)
// state, not the more powerful one.
function isEnabled(envVarName: string): boolean {
  return process.env[envVarName] === 'true';
}

// Master kill switch for the entire AI audit engine (lib/inngest/functions/audit.ts).
// Independent of any jurisdiction's `coverage_level` -- this is an ops-level
// rollback lever (e.g. a bad prompt revision, a corpus quality regression),
// while coverage_level is a per-jurisdiction product decision. Both are
// checked before any model call is made.
export function isAiAuditEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_AI_AUDIT');
}

// Gates the vector half of hybrid retrieval (search_jurisdiction_code_chunks
// migration 20260806000014). Off by default because the MVP corpus starts
// empty -- there's nothing to embed a query against yet, and Voyage calls
// cost money for zero benefit until real chunks are ingested. BM25
// (content_tsv) retrieval still runs regardless of this flag.
export function isVectorRetrievalEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_VECTOR_RETRIEVAL');
}

// Phase 4, declared here now so all three flags live in one file.
export function isPdfFillEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_PDF_FILL');
}

// Lifecycle & Compliance Expansion, Phase 1.0. Gates nothing at runtime yet
// -- there is no route or UI branch that reads it in this phase, since
// lib/authz's can() and lib/audit/log.ts's writeAuditLog() are foundation
// modules with zero call sites (see their own header comments). Declared
// now, off by default, so the later phase that actually wires enforcement in
// only has to flip this flag on, not invent it.
export function isLifecycleCoreEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_LIFECYCLE_CORE');
}
