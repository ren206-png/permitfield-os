import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { LockedFeature } from '@/components/locked-feature';
import { NewEstimateForm } from './new-estimate-form';

// Gate 4 (Quotes & Payments), Phase A. No standalone /clients/new page
// exists anywhere in this codebase (grepped before writing this -- clients
// are currently only creatable inline via
// app/(app)/projects/new/actions.ts's create_project_with_intake RPC), so
// an org with zero clients is directed there rather than to a page that
// doesn't exist -- same "don't render a dead-end control" instinct
// app/(app)/applications/new/page.tsx already uses for its own
// zero-contractors case.
export default async function NewEstimatePage() {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'quotes.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Estimates unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const supabase = await createClient();
  const [clientsResult, projectsResult] = await Promise.all([
    supabase.from('clients').select('id, name').eq('org_id', orgId).is('archived_at', null).order('name', { ascending: true }),
    supabase.from('projects').select('id, title').eq('org_id', orgId).is('archived_at', null).order('title', { ascending: true }),
  ]);

  if (clientsResult.error) {
    throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  }
  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }

  const clients = clientsResult.data ?? [];

  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Add a client first</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Every estimate is billed to a client on your account. Start a project to add one, then come back here.
        </p>
        <Link
          href="/projects/new"
          className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          Start a project
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">New estimate</h1>
      <p className="mt-1 text-sm text-zinc-600">Draft a quote. Add line items now, or save the draft and add them later.</p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewEstimateForm clients={clients} projects={projectsResult.data ?? []} />
      </div>
    </div>
  );
}
