import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';

// The `clients` table (supabase/migrations/
// 20260806000019_lifecycle_intake_properties_clients_taxonomies.sql) has
// existed since Gate 1.1, but that migration's own header comment
// documents "no standalone /clients/new or /properties/new page exists in
// this gate" as a deliberate scope decision for that phase specifically --
// the only writer was, until this page, the atomic create_project_with_intake
// RPC (app/(app)/projects/new/actions.ts). This is that deferred standalone
// management surface. It does not touch that RPC or its atomicity guarantee
// (the "client created, then property/project insert fails, orphaned client
// row" risk that migration's comment describes) -- a standalone client
// create/edit here is always a single-table write with no multi-table
// transaction to roll back.
//
// Same search/filter shape as app/(app)/applications/page.tsx: a GET
// <form> re-fetching server-side (no client JS/state, page stays an async
// Server Component), searching name/email/phone via `.or()` with the same
// `%`/`,` escaping that file's header comment explains.
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { orgId } = await requireOrgContext();
  const { q } = await searchParams;
  const supabase = await createClient();

  // RLS (`clients_select`, is_org_member(org_id)) already scopes this to
  // the caller's org -- the explicit .eq('org_id', orgId) is redundant with
  // RLS but kept anyway, same rationale as applications/page.tsx's own
  // comment on this.
  let query = supabase
    .from('clients')
    .select('id, name, email, phone, created_at')
    .eq('org_id', orgId)
    .is('archived_at', null);

  const trimmedQuery = q?.trim();
  if (trimmedQuery) {
    const escaped = trimmedQuery.replace(/[%,]/g, '\\$&');
    query = query.or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }

  const { data: clients, error } = await query.order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to load clients: ${error.message}`);
  }

  const hasActiveFilters = Boolean(trimmedQuery);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Clients</h1>
        <Link
          href="/clients/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          Add client
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search name, email, or phone"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Search
        </button>
        {hasActiveFilters && (
          <Link href="/clients" className="text-sm text-zinc-500 underline hover:text-zinc-900">
            Clear
          </Link>
        )}
      </form>

      {clients && clients.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <p className="font-medium text-zinc-900">{client.name}</p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact info on file'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : hasActiveFilters ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No clients match your search.</p>
          <Link href="/clients" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Clear search
          </Link>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No clients yet.</p>
          <Link href="/clients/new" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Add your first client
          </Link>
        </div>
      )}
    </div>
  );
}
