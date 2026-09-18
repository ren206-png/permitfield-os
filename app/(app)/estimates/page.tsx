import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { EstimateStatusBadge } from '@/components/estimate-status-badge';
import { LockedFeature } from '@/components/locked-feature';

// Same literal union components/estimate-status-badge.tsx already declares
// for this enum -- duplicated here only so this page's status <select> can
// be exhaustively validated against real values below, matching
// app/(app)/applications/page.tsx's own APPLICATION_STATUSES precedent.
const ESTIMATE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'void'] as const;
type EstimateStatusFilter = (typeof ESTIMATE_STATUSES)[number];

function isKnownStatus(value: string): value is EstimateStatusFilter {
  return (ESTIMATE_STATUSES as readonly string[]).includes(value);
}

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/applications/page.tsx's shape (list query + card-per-row +
// empty state) -- the only genuinely complete list/detail/create analog in
// this codebase. Double-gated: flag first (notFound() -- route doesn't
// exist at all when off), then the 'quotes.manage' entitlement (rendered as
// a LockedFeature card rather than notFound(), since the route itself is
// real once the flag is on -- only the org's plan determines whether it can
// use it, same distinction app/(app)/settings/billing/page.tsx draws
// between isBillingEnabled() and the owner-only edit capability).
//
// Search/filter added on top of the original plain `.order('created_at')`
// list, same GET-form + searchParams shape as the Applications page. `q`
// searches the linked client's name, not any column on `estimates` itself
// (there's no free-text field worth searching there) -- since PostgREST's
// embedded-resource filtering would need a `clients!inner(...)` join to
// filter parent rows (untested against this schema, and this codebase has
// no existing precedent for it -- checked), this instead does a plain
// two-step lookup: find matching client ids first, then `.in('client_id',
// ...)` on the real query, the same `.in()`-after-lookup shape
// lib/jurisdictions/public-directory.ts and
// lib/inngest/functions/reminders.ts already use elsewhere in this repo.
export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
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

  const { q, status } = await searchParams;
  const supabase = await createClient();

  const trimmedQuery = q?.trim();
  // null means "no query typed" (skip the client lookup entirely); [] means
  // "a query was typed but matched zero clients" (short-circuit to an empty
  // result below without ever querying `estimates`).
  let matchingClientIds: string[] | null = null;
  if (trimmedQuery) {
    const escaped = trimmedQuery.replace(/[%,]/g, '\\$&');
    const { data: matchingClients, error: clientsError } = await supabase
      .from('clients')
      .select('id')
      .eq('org_id', orgId)
      .ilike('name', `%${escaped}%`);
    if (clientsError) {
      throw new Error(`Failed to search clients: ${clientsError.message}`);
    }
    matchingClientIds = (matchingClients ?? []).map((c) => c.id);
  }

  // No generated database.types.ts exists in this repo, so the Supabase
  // client's inferred row shape is `any` -- see
  // app/(app)/invoices/page.tsx's matching comment for why this is
  // annotated loosely rather than hand-typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let estimates: any[] = [];

  if (matchingClientIds === null || matchingClientIds.length > 0) {
    let query = supabase
      .from('estimates')
      .select('id, status, currency_code, expiry_date, created_at, clients ( name )')
      .eq('org_id', orgId);

    if (status && isKnownStatus(status)) {
      query = query.eq('status', status);
    }
    if (matchingClientIds !== null) {
      query = query.in('client_id', matchingClientIds);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw new Error(`Failed to load estimates: ${error.message}`);
    }
    estimates = data ?? [];
  }

  const hasActiveFilters = Boolean(trimmedQuery) || Boolean(status);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Estimates</h1>
        <Link
          href="/estimates/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          New estimate
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search client name"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <select
          name="status"
          defaultValue={status && isKnownStatus(status) ? status : ''}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {ESTIMATE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Filter
        </button>
        {hasActiveFilters && (
          <Link href="/estimates" className="text-sm text-zinc-500 underline hover:text-zinc-900">
            Clear
          </Link>
        )}
      </form>

      {estimates.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {estimates.map((estimate) => {
            const client = Array.isArray(estimate.clients) ? estimate.clients[0] : estimate.clients;
            return (
              <li key={estimate.id}>
                <Link
                  href={`/estimates/${estimate.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-zinc-900">{client?.name ?? 'Unknown client'}</p>
                      <p className="mt-0.5 text-sm text-zinc-500">{estimate.currency_code}</p>
                      {estimate.expiry_date && (
                        <p className="mt-1 text-sm text-zinc-600">Expires {estimate.expiry_date}</p>
                      )}
                    </div>
                    <EstimateStatusBadge status={estimate.status} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : hasActiveFilters ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No estimates match your search.</p>
          <Link href="/estimates" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No estimates yet.</p>
          <Link href="/estimates/new" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Create your first estimate
          </Link>
        </div>
      )}
    </div>
  );
}
