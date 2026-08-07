import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isIntakeEnabled } from '@/lib/flags';
import { createClient } from '@/lib/supabase/server';
import { NewProjectForm } from './new-project-form';

// Lifecycle & Compliance Expansion, Phase 1.1. Flag-gated the same way
// createProjectAction is (see actions.ts's header comment) -- notFound()
// here means this route doesn't exist at all with the flag off, not just
// "hidden from nav," matching how a genuinely unshipped feature should
// behave rather than a soft UI hint.
export default async function NewProjectPage() {
  if (!isIntakeEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  // Populates the project-type <select> below. Seeded by
  // create_organization_with_owner() (20260806000019) for every org created
  // from this phase forward, and backfilled for the Org A/B test fixtures
  // via supabase/seed.sql -- a brand-new org outside either of those two
  // paths (hypothetically, one created before this migration ran) would see
  // an empty list here, which the form already treats as "no taxonomy
  // selected" rather than an error.
  const { data: taxonomies } = await supabase
    .from('taxonomies')
    .select('id, label')
    .eq('org_id', orgId)
    .eq('kind', 'project_type')
    .is('archived_at', null)
    .order('sort_order', { ascending: true });

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">New project</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Start a project file. You can add the client and property now, or leave them for later.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewProjectForm taxonomies={taxonomies ?? []} />
      </div>
    </div>
  );
}
