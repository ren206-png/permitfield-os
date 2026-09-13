import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { EstimateStatusBadge } from '@/components/estimate-status-badge';
import { LockedFeature } from '@/components/locked-feature';

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/applications/page.tsx's shape (list query + card-per-row +
// empty state) -- the only genuinely complete list/detail/create analog in
// this codebase. Double-gated: flag first (notFound() -- route doesn't
// exist at all when off), then the 'quotes.manage' entitlement (rendered as
// a LockedFeature card rather than notFound(), since the route itself is
// real once the flag is on -- only the org's plan determines whether it can
// use it, same distinction app/(app)/settings/billing/page.tsx draws
// between isBillingEnabled() and the owner-only edit capability).
export default async function EstimatesPage() {
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
  const { data: estimates, error } = await supabase
    .from('estimates')
    .select('id, status, currency_code, expiry_date, created_at, clients ( name )')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load estimates: ${error.message}`);
  }

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

      {estimates && estimates.length > 0 ? (
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
