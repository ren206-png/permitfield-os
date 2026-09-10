import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';
import { fetchAllRows } from '@/lib/supabase/paginate';

// LP workstream, Phase 3 (jurisdiction SEO pages). This is the one module
// allowed to read jurisdiction/permit-type data on behalf of an
// unauthenticated, public request. Ren was given two resolution options for
// the RLS blocker found while building this phase and replied "build both
// options," so this module implements both as switchable strategies rather
// than picking one:
//
//   'anon-rls'     (default) -- Option A. Uses the ordinary
//                  lib/supabase/server.ts client, which an unauthenticated
//                  request runs as Postgres's `anon` role. Preferred
//                  default: it goes through the ordinary RLS-respecting
//                  client, same as every other route in this codebase, so
//                  there is nothing route-specific to reason about.
//
//   'service-role' -- Option B. Uses lib/supabase/service-client.ts's
//                  sanctioned, narrowly-documented exception (see that
//                  file's header). Dormant unless
//                  PERMITFIELD_JURISDICTION_DATA_STRATEGY=service-role is
//                  explicitly set -- e.g. as a fallback if Option A's
//                  migration is ever rolled back in a given environment
//                  without the code also being reverted.
//
// Both strategies query the same two views, not the base tables --
// public_jurisdictions and public_permit_types
// (supabase/migrations/20260806000035_public_jurisdiction_directory_views.sql).
// That migration is a follow-up tightening: an earlier version of this file
// queried jurisdictions/authorities/permit_types directly, gated only by
// this file's own `.in('coverage_level', ...)` filter -- which was an
// application-layer curation, not a database guarantee. Anon's RLS policy
// on the base tables was `using (true)`, so anyone hitting the Supabase
// REST API directly (not through this module) could read every row,
// including `listed` jurisdictions. The two views bake the
// Verified/Assisted filter into the grant itself, so anon (and
// service_role, granted on the views purely for code-path unification with
// the 'service-role' strategy) can no longer reach the base tables' full
// contents at all -- see 20260806000035's header for the view-ownership
// mechanics. The `.in('coverage_level', ...)` filter below is kept anyway,
// as defense in depth independent of whichever layer is doing the real
// enforcement -- same discipline as the narrow column selects (never
// `select('*')`) that were already here.
type DataStrategy = 'anon-rls' | 'service-role';

function getStrategy(): DataStrategy {
  return process.env.PERMITFIELD_JURISDICTION_DATA_STRATEGY === 'service-role'
    ? 'service-role'
    : 'anon-rls';
}

async function getReadClient() {
  if (getStrategy() === 'service-role') {
    return createServiceClient();
  }
  return createClient();
}

export type PublicCoverageLevel = 'verified' | 'assisted';

export type PublicJurisdiction = {
  id: string;
  provinceCode: string;
  municipality: string;
  region: string | null;
  coverageLevel: PublicCoverageLevel;
  portalUrl: string | null;
};

export type PublicJurisdictionListing = PublicJurisdiction & {
  // Thin-content rule (master prompt §6): a jurisdiction only gets a
  // linkable detail page once it has real permit-type content, not just a
  // coverage badge. Ottawa (assisted, zero permit_types rows in
  // supabase/seed.sql today) is the concrete case this flag exists for.
  hasDetailPage: boolean;
};

export type PublicPermitType = {
  id: string;
  title: string;
  verifiedAt: string | null;
};

// Only 'verified' and 'assisted' -- 'listed' jurisdictions have no reviewed
// content yet and must never get a public page implying otherwise (same
// tier discipline components/coverage-badge.tsx enforces in-product).
const PUBLIC_COVERAGE_LEVELS: PublicCoverageLevel[] = ['verified', 'assisted'];

// Same silent-truncation risk documented and fixed in lib/supabase/paginate.ts
// (shared implementation used here): PostgREST's default `db max rows`
// config caps a single .select() response at 1000 rows with no error and no
// indication anything was cut off. This module's own comment above already
// flags the dataset as "small... today" (4 jurisdiction rows in
// supabase/seed.sql) but it's the backing data source for a growing public
// SEO jurisdiction directory -- expanding jurisdiction-by-jurisdiction is the
// explicit product direction (JURISDICTION_EXPANSION_SCOPE.md), so a query
// that silently drops rows past 1000 would silently de-list
// jurisdictions/permit-types from the public index with no error surfaced
// anywhere. Both call sites below already have a deterministic ORDER BY
// (province_code+municipality) or an implicit one (jurisdiction_id IN filter
// has no required order since every returned id is later only used to build
// a Set).

export async function getPublicJurisdictions(): Promise<PublicJurisdiction[]> {
  const supabase = await getReadClient();
  const data = await fetchAllRows<{
    id: string;
    province_code: string;
    municipality: string;
    region: string | null;
    coverage_level: string;
    portal_url: string | null;
  }>((from, to) =>
    supabase
      .from('public_jurisdictions')
      .select('id, province_code, municipality, region, coverage_level, portal_url')
      .in('coverage_level', PUBLIC_COVERAGE_LEVELS)
      .order('province_code', { ascending: true })
      .order('municipality', { ascending: true })
      .range(from, to),
    'public jurisdictions'
  );

  return data.map((row) => ({
    id: row.id,
    provinceCode: row.province_code,
    municipality: row.municipality,
    region: row.region,
    coverageLevel: row.coverage_level as PublicCoverageLevel,
    portalUrl: row.portal_url,
  }));
}

export async function getPermitTypesForJurisdiction(
  jurisdictionId: string
): Promise<PublicPermitType[]> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from('public_permit_types')
    .select('id, title, verified_at')
    .eq('jurisdiction_id', jurisdictionId)
    .order('title', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    verifiedAt: row.verified_at,
  }));
}

// Bulk variant for the /coverage index page, so it doesn't issue N+1 queries
// (one per jurisdiction) to determine which ones have a linkable detail page.
export async function getPublicJurisdictionsForIndex(): Promise<PublicJurisdictionListing[]> {
  const jurisdictions = await getPublicJurisdictions();
  if (jurisdictions.length === 0) {
    return [];
  }

  const supabase = await getReadClient();
  const data = await fetchAllRows<{ jurisdiction_id: string }>((from, to) =>
    supabase
      .from('public_permit_types')
      .select('jurisdiction_id')
      .in(
        'jurisdiction_id',
        jurisdictions.map((j) => j.id)
      )
      .range(from, to),
    'public permit types for jurisdiction index'
  );

  const idsWithContent = new Set(data.map((row) => row.jurisdiction_id));

  return jurisdictions.map((j) => ({
    ...j,
    hasDetailPage: idsWithContent.has(j.id),
  }));
}

export async function findJurisdictionBySlug(
  regionSlug: string,
  citySlug: string
): Promise<PublicJurisdiction | null> {
  const jurisdictions = await getPublicJurisdictions();
  const normalizedRegion = regionSlug.trim().toLowerCase();
  const normalizedCity = citySlug.trim().toLowerCase();

  return (
    jurisdictions.find(
      (j) =>
        provinceSlug(j.provinceCode) === normalizedRegion &&
        municipalitySlug(j.municipality) === normalizedCity
    ) ?? null
  );
}

// Slug scheme for /permits/ca/[region]/[city]: region is the province code
// lowercased (on, ab); city is the municipality name, lowercased and
// hyphenated. Small, fixed dataset (4 rows in supabase/seed.sql today), so
// matching in application code against getPublicJurisdictions() (rather than
// a slug column in the database) is simple and avoids adding a new column
// for a value that's always derivable from existing ones.
export function provinceSlug(provinceCode: string): string {
  return provinceCode.trim().toLowerCase();
}

export function municipalitySlug(municipality: string): string {
  return municipality
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
