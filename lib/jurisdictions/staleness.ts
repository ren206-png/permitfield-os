// Lifecycle & Compliance Expansion, Phase 1.2: application-layer mirror of
// supabase/migrations/20260806000021_jurisdiction_sources.sql's
// `jurisdiction_source_effective_status()` SQL function.
//
// *** WHY THIS DUPLICATES SQL LOGIC IN TYPESCRIPT ***
// SS3.3 requires staleness be "automatic" and that a stale, previously-
// verified source "must render with a visible warning -- do not require a
// human to notice." The SQL function is the source of truth for anything
// read directly out of Postgres (e.g. a future Server Component doing
// `select *`). But this repo also has precedent (lib/entitlements/index.ts)
// for a DB-independent, pure, unit-testable TypeScript function wherever a
// UI needs the same decision without a round-trip -- e.g. re-deriving
// "is this stale" client-side against a value already fetched, or a form
// that needs to warn before submission. Both implementations must agree;
// see this file's test for a same-inputs/same-output cross-check against
// the SQL function's documented behavior (this module has no DB access of
// its own, same discipline as lib/authz and lib/entitlements, so the actual
// SQL function cannot be executed from this test -- the check is against
// the *documented* threshold semantics, not a live query).
//
// *** THIS DOES NOT MUTATE ANYTHING. *** Same as the SQL function, this
// never rewrites a stored `verification_status` -- it only computes what a
// UI should currently display. No route or component calls this yet (see
// lib/flags.ts's isJurisdictionsEnabled() header comment) -- it exists so
// the eventual first caller has a tested, correct implementation to reach
// for instead of re-deriving the threshold math inline.

export type JurisdictionSourceVerificationStatus =
  | 'unverified'
  | 'pending_review'
  | 'verified'
  | 'stale'
  | 'disputed';

// SS3.3's literal default. A named export (not inlined) so a future
// per-org/per-jurisdiction override reads from one place, and so tests can
// assert against it by name rather than a magic number.
export const DEFAULT_STALENESS_THRESHOLD_DAYS = 180;

// Mirrors jurisdiction_source_effective_status()'s exact branching: only a
// 'verified' row with a non-null verified_at can ever become 'stale'; every
// other stored status (including an already-'stale' or 'disputed' row)
// passes through unchanged. `now` is an injectable parameter (defaulting to
// `new Date()`) purely so this stays a pure function under test -- no
// wall-clock dependency baked in, same reasoning as accepting `orgId` in
// lib/entitlements even though nothing branches on wall-clock time inside a
// single call.
export function computeEffectiveVerificationStatus(
  status: JurisdictionSourceVerificationStatus,
  verifiedAt: Date | string | null,
  thresholdDays: number = DEFAULT_STALENESS_THRESHOLD_DAYS,
  now: Date = new Date()
): JurisdictionSourceVerificationStatus {
  if (status !== 'verified' || verifiedAt === null) {
    return status;
  }

  const verifiedAtMs = typeof verifiedAt === 'string' ? new Date(verifiedAt).getTime() : verifiedAt.getTime();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  // Strict `>`, not `>=`, to match the SQL function's `verified_at < now() -
  // threshold` exactly (equivalent to `now() - verified_at > threshold`) --
  // a source verified EXACTLY threshold_days ago is not yet stale in either
  // implementation.
  return now.getTime() - verifiedAtMs > thresholdMs ? 'stale' : 'verified';
}

// SS3.3: "must render with a visible warning." A pure boolean seam so a UI
// component's warning-banner branch is `isStale(...)`, not a re-derivation
// of computeEffectiveVerificationStatus's threshold math inline.
export function isStale(
  status: JurisdictionSourceVerificationStatus,
  verifiedAt: Date | string | null,
  thresholdDays: number = DEFAULT_STALENESS_THRESHOLD_DAYS,
  now: Date = new Date()
): boolean {
  return computeEffectiveVerificationStatus(status, verifiedAt, thresholdDays, now) === 'stale';
}
