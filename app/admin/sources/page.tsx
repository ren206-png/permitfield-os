import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { computeFreshness, FRESHNESS_POLICY_DAYS, type Freshness, type SourceType } from '@/lib/sources/freshness';
import { createServiceClient } from '@/lib/supabase/service-client';
import { CheckNowButton } from './source-controls';

// Source registry (Gate 6.3): every active registered source with its
// freshness, last check and how many fetched changes are waiting for review.
// Reads use the service client after requireAdmin(), same as the other
// /admin pages; writes (actions.ts) use the admin's own session.

interface SourceRow {
  id: string;
  url: string;
  source_type: SourceType;
  jurisdictions: { municipality: string | null; province_code: string } | { municipality: string | null; province_code: string }[] | null;
}

interface StatusRow {
  source_id: string;
  last_attempt_at: string | null;
  last_outcome: string | null;
  last_success_at: string | null;
  open_captures: number;
}

const FRESHNESS_BADGE: Record<Freshness, { label: string; className: string }> = {
  fresh: { label: 'Fresh', className: 'bg-emerald-50 text-emerald-700' },
  overdue: { label: 'Overdue', className: 'bg-amber-50 text-amber-800' },
  never_checked: { label: 'Never checked', className: 'bg-zinc-100 text-zinc-700' },
};

const OUTCOME_LABEL: Record<string, string> = {
  changed: 'Changed',
  unchanged: 'Unchanged',
  not_modified: 'Unchanged (304)',
  failed: 'Failed',
  blocked: 'Refused',
};

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function SourcesPage() {
  await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();

  const supabase = createServiceClient();
  const [{ data: sources, error }, { data: statuses, error: statusError }] = await Promise.all([
    supabase
      .from('jurisdiction_sources')
      .select('id, url, source_type, jurisdictions ( municipality, province_code )')
      .is('archived_at', null)
      .order('url'),
    supabase.rpc('source_check_status'),
  ]);
  if (error || statusError) throw new Error(`Could not load sources: ${(error ?? statusError)?.message}`);

  const statusById = new Map(((statuses ?? []) as StatusRow[]).map((s) => [s.source_id, s]));
  const rows = ((sources ?? []) as SourceRow[])
    .map((s) => {
      const j = first(s.jurisdictions);
      return { ...s, place: j ? `${j.municipality ?? 'Province-wide'}, ${j.province_code}` : 'Unknown', status: statusById.get(s.id) };
    })
    .sort((a, b) => a.place.localeCompare(b.place) || a.url.localeCompare(b.url));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Sources</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          Official pages the requirements come from. Each is re-read on a schedule (
          {Object.entries(FRESHNESS_POLICY_DAYS)
            .map(([type, days]) => `${type.replace('_', ' ')} every ${days} days`)
            .join(', ')}
          ). A changed page waits here for review: nothing is used as evidence until you publish it. A failed check never retires a source.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Place</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Freshness</th>
              <th className="px-3 py-2">Last check</th>
              <th className="px-3 py-2">To review</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => {
              const freshness = computeFreshness(row.source_type, row.status?.last_success_at ?? null);
              const badge = FRESHNESS_BADGE[freshness];
              const open = Number(row.status?.open_captures ?? 0);
              return (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-700">{row.place}</td>
                  <td className="max-w-md px-3 py-2">
                    <Link href={`/admin/sources/${row.id}`} className="break-all text-zinc-900 underline-offset-2 hover:underline">
                      {row.url}
                    </Link>
                    <div className="text-xs text-zinc-500">{row.source_type.replace('_', ' ')}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">
                    {row.status?.last_attempt_at ? (
                      <>
                        {OUTCOME_LABEL[row.status.last_outcome ?? ''] ?? row.status.last_outcome} · <LocalTime value={row.status.last_attempt_at} />
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {open > 0 ? (
                      <Link href={`/admin/sources/${row.id}`} className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
                        {open} change{open === 1 ? '' : 's'}
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CheckNowButton sourceId={row.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-500">
                  No sources registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
