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

// Lifecycle & Compliance Expansion, Phase 1.1. Gates the project intake UI
// (app/(app)/projects/new/) and its Server Action -- this is the first flag
// in this file with a real route call site (createProjectAction calls
// notFound() when this is off; see that file's header comment). The
// underlying schema (taxonomies/clients/properties/projects,
// 20260806000019) and RLS exist regardless of this flag's value, same as
// every other flag here: the flag gates the application-layer entry point,
// not the table's existence.
export function isIntakeEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_INTAKE');
}

// Lifecycle & Compliance Expansion, Phase 1.2. Gates nothing at runtime yet --
// same "declared ahead of its consumer" pattern as isLifecycleCoreEnabled
// above: this gate ships supabase/migrations/20260806000021_jurisdiction_sources.sql
// (schema, RLS, the verify_jurisdiction_source() RPC, and the staleness
// computation) with zero UI or Server Action call site. The table's RLS and
// grants are live regardless of this flag's value, same as every other flag
// in this file -- the flag will gate the application-layer entry point once
// a later phase adds one (SS3.3's own "every requirement surfaced to a user
// renders ..." bullet is Gate 1.6/1.7 scope, not this one).
export function isJurisdictionsEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_JURISDICTIONS');
}

// Lifecycle & Compliance Expansion, Phase 1.3. Gates nothing at runtime yet --
// same "declared ahead of its consumer" pattern as isLifecycleCoreEnabled/
// isJurisdictionsEnabled above: this gate ships
// supabase/migrations/20260806000022_permit_status_machine.sql (the
// permit_status_enum column, application_status_history, and
// transition_permit_status()) and 20260806000023 (the project_id backfill)
// with zero UI or Server Action call site. The schema, RLS, and RPC are live
// regardless of this flag's value, same as every other flag in this file --
// the flag will gate the application-layer entry point once a later phase
// adds one. Named for the master prompt's own gate identifier
// ("permitfield_applications"), not "permit_status", since the gate covers
// permit applications generally (project_id linkage, evidence columns), not
// only the status machine.
export function isApplicationsEnabled(): boolean {
  return isEnabled('PERMITFIELD_FF_APPLICATIONS');
}
