import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { NewApplicationForm } from './new-application-form';

// jurisdictions/permit_types/authorities are reference data (select-only for
// `authenticated`, see migrations 000004/000005) -- readable across orgs, so
// no org_id filter belongs on these two queries. Only contractors and the
// eventual insert are org-scoped.
//
// Health-check audit finding: jurisdictions/permit_types were previously
// fetched with no .range() pagination -- a small, fixed dataset today (4
// jurisdictions in supabase/seed.sql), but the stated product direction is
// jurisdiction-by-jurisdiction expansion (JURISDICTION_EXPANSION_SCOPE.md),
// same growth path already flagged for lib/jurisdictions/public-directory.ts.
// Paginated here too so this wizard doesn't silently start omitting
// jurisdictions/permit types from its dropdowns once the platform grows past
// PostgREST's default 1000-row cap. contractors is left as a single
// unpaginated, org-scoped query -- realistically bounded by one org's own
// contractor roster, not a cross-tenant reference table.
export default async function NewApplicationPage() {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const [jurisdictionsResult, permitTypesResult, contractorsResult] = await Promise.allSettled([
    fetchAllRows<{ id: string; municipality: string; province_code: string; coverage_level: string }>(
      (from, to) =>
        supabase
          .from('jurisdictions')
          .select('id, municipality, province_code, coverage_level')
          .order('province_code', { ascending: true })
          .order('municipality', { ascending: true })
          .range(from, to),
      'jurisdictions'
    ),
    fetchAllRows<{ id: string; title: string; jurisdiction_id: string }>(
      (from, to) =>
        supabase
          .from('permit_types')
          .select('id, title, jurisdiction_id')
          .order('title', { ascending: true })
          .range(from, to),
      'permit types'
    ),
    supabase.from('contractors').select('id, company_name').eq('org_id', orgId).order('company_name', { ascending: true }),
  ]);

  if (jurisdictionsResult.status === 'rejected') {
    throw new Error(`Failed to load wizard data: ${jurisdictionsResult.reason}`);
  }
  if (permitTypesResult.status === 'rejected') {
    throw new Error(`Failed to load wizard data: ${permitTypesResult.reason}`);
  }
  if (contractorsResult.status === 'rejected') {
    throw new Error(`Failed to load wizard data: ${contractorsResult.reason}`);
  }
  const jurisdictions = jurisdictionsResult.value;
  const permitTypes = permitTypesResult.value;
  const { data: contractors, error: contractorsError } = contractorsResult.value;

  if (contractorsError) {
    throw new Error(`Failed to load wizard data: ${contractorsError.message}`);
  }

  // Gate on zero contractors rather than letting the form render with an
  // empty, unusable contractor <select> -- same "don't render a dead-end
  // control" instinct as the coverage-tier messaging below.
  if (!contractors || contractors.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Add a contractor first</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Every application is filed under a licensed contractor on your account. Add one to continue.
        </p>
        <Link
          href="/contractors/new?returnTo=/applications/new"
          className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          Add contractor
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">New application</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Pick the jurisdiction and permit type this project needs, then fill in the project basics.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewApplicationForm
          jurisdictions={jurisdictions}
          permitTypes={permitTypes}
          contractors={contractors}
        />
      </div>
    </div>
  );
}
