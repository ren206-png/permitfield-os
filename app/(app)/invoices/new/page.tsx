import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { LockedFeature } from '@/components/locked-feature';
import { NewInvoiceForm } from './new-invoice-form';

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/estimates/new/page.tsx's shape exactly, including the same
// zero-clients redirect-to-/projects/new fallback -- see that file's header
// comment. Additionally loads accepted estimates for the org so the form
// can offer an optional "create from estimate" source (metadata-only
// traceability via invoices.source_estimate_id -- line items are always
// re-entered manually here in Phase A rather than auto-copied, since no
// existing precedent in this codebase performs an estimate->invoice line
// item carry-over and building one is out of scope for this pass).
export default async function NewInvoicePage() {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'invoices.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Invoices unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const supabase = await createClient();
  const [clientsResult, projectsResult, estimatesResult] = await Promise.all([
    supabase.from('clients').select('id, name').eq('org_id', orgId).is('archived_at', null).order('name', { ascending: true }),
    supabase.from('projects').select('id, title').eq('org_id', orgId).is('archived_at', null).order('title', { ascending: true }),
    supabase
      .from('estimates')
      .select('id, expiry_date, clients ( name )')
      .eq('org_id', orgId)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false }),
  ]);

  if (clientsResult.error) {
    throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  }
  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }
  if (estimatesResult.error) {
    throw new Error(`Failed to load accepted estimates: ${estimatesResult.error.message}`);
  }

  const clients = clientsResult.data ?? [];

  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Add a client first</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Every invoice is billed to a client on your account. Start a project to add one, then come back here.
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

  const estimates = (estimatesResult.data ?? []).map((e) => {
    const client = Array.isArray(e.clients) ? e.clients[0] : e.clients;
    return { id: e.id, label: client?.name ?? 'Unknown client' };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">New invoice</h1>
      <p className="mt-1 text-sm text-zinc-600">Draft an invoice. Add line items now, or save the draft and add them later.</p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewInvoiceForm clients={clients} projects={projectsResult.data ?? []} estimates={estimates} />
      </div>
    </div>
  );
}
