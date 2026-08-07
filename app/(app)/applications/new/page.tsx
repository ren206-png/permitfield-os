import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { NewApplicationForm } from './new-application-form';

// jurisdictions/permit_types/authorities are reference data (select-only for
// `authenticated`, see migrations 000004/000005) -- readable across orgs, so
// no org_id filter belongs on these two queries. Only contractors and the
// eventual insert are org-scoped.
export default async function NewApplicationPage() {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const [{ data: jurisdictions, error: jurisdictionsError }, { data: permitTypes, error: permitTypesError }, { data: contractors, error: contractorsError }] =
    await Promise.all([
      supabase
        .from('jurisdictions')
        .select('id, municipality, province_code, coverage_level')
        .order('province_code', { ascending: true })
        .order('municipality', { ascending: true }),
      supabase
        .from('permit_types')
        .select('id, title, jurisdiction_id')
        .order('title', { ascending: true }),
      supabase
        .from('contractors')
        .select('id, company_name')
        .eq('org_id', orgId)
        .order('company_name', { ascending: true }),
    ]);

  if (jurisdictionsError || permitTypesError || contractorsError) {
    throw new Error(
      `Failed to load wizard data: ${jurisdictionsError?.message ?? permitTypesError?.message ?? contractorsError?.message}`
    );
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
          jurisdictions={jurisdictions ?? []}
          permitTypes={permitTypes ?? []}
          contractors={contractors}
        />
      </div>
    </div>
  );
}
