import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { reviewCounts, reviewStatus, type ReviewStatus } from '@/lib/requirements/review';
import { createServiceClient } from '@/lib/supabase/service-client';
import { EditRequirementForm, RetireButton, VerifyButton } from '../requirement-controls';

// Requirements review for one permit type: each catalog requirement next to
// the source it was copied from, with Verify / Edit / Retire.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequirementRow {
  id: string;
  title: string;
  description: string | null;
  applies_when: string | null;
  display_order: number | null;
  verification_status: string;
  verified_at: string | null;
  verified_by: string | null;
  archived_at: string | null;
  jurisdiction_sources: { url: string; notes: string | null } | { url: string; notes: string | null }[] | null;
}

const STATUS_BADGE: Record<ReviewStatus, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'bg-emerald-50 text-emerald-700' },
  stale: { label: 'Re-check due', className: 'bg-amber-50 text-amber-800' },
  pending: { label: 'Not reviewed', className: 'bg-zinc-100 text-zinc-700' },
  retired: { label: 'Retired', className: 'bg-zinc-100 text-zinc-500' },
};

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function PermitTypeRequirementsPage({ params }: { params: Promise<{ permitTypeId: string }> }) {
  await requireAdmin();
  const { permitTypeId } = await params;
  if (!UUID_PATTERN.test(permitTypeId)) notFound();

  const supabase = createServiceClient();
  const [{ data: permitType }, { data: requirements, error }] = await Promise.all([
    supabase.from('permit_types').select('title, jurisdictions ( municipality, province_code )').eq('id', permitTypeId).maybeSingle(),
    supabase
      .from('permit_requirements')
      .select('id, title, description, applies_when, display_order, verification_status, verified_at, verified_by, archived_at, jurisdiction_sources ( url, notes )')
      .eq('permit_type_id', permitTypeId)
      .order('display_order', { ascending: true, nullsFirst: false }),
  ]);
  if (!permitType) notFound();
  if (error) throw new Error(`Failed to load requirements: ${error.message}`);

  const rows = (requirements ?? []) as RequirementRow[];
  const reviewerIds = [...new Set(rows.map((row) => row.verified_by).filter((id): id is string => Boolean(id)))];
  const reviewers = new Map<string, string>();
  await Promise.all(
    reviewerIds.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      reviewers.set(id, data.user?.email ?? 'unknown reviewer');
    })
  );

  const jurisdiction = first(
    permitType.jurisdictions as { municipality: string | null; province_code: string } | { municipality: string | null; province_code: string }[] | null
  );
  const place = jurisdiction ? `${jurisdiction.municipality ?? jurisdiction.province_code}, ${jurisdiction.province_code}` : 'Unknown';
  const sources = [...new Map(rows.map((row) => first(row.jurisdiction_sources)).filter(Boolean).map((s) => [s!.url, s!])).values()];
  const counts = reviewCounts(rows);

  return (
    <div>
      <Link href="/admin/requirements" className="text-xs text-zinc-500 underline underline-offset-2">
        All cities
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-zinc-900">
        {place} · {permitType.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-700">
        {counts.verified} verified · {counts.pending} not reviewed
        {counts.stale > 0 && ` · ${counts.stale} due for re-check`}
        {counts.retired > 0 && ` · ${counts.retired} retired`}
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
        <p className="text-xs font-medium text-zinc-500">Source to compare against</p>
        {sources.length === 0 && <p className="mt-1 text-zinc-600">No source recorded.</p>}
        {sources.map((source) => (
          <div key={source.url} className="mt-1">
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-zinc-900 underline underline-offset-2">
              {source.url}
            </a>
            {source.notes && <p className="text-xs text-zinc-600">{source.notes}</p>}
          </div>
        ))}
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => {
          const status = reviewStatus(row);
          const badge = STATUS_BADGE[status];
          return (
            <li key={row.id} className={`rounded-lg border border-zinc-200 bg-white p-3 ${status === 'retired' ? 'opacity-60' : ''}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {row.title}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                    <span className="ml-1 text-[11px] text-zinc-500">{row.applies_when ? 'optional' : 'required'}</span>
                  </p>
                  {row.applies_when && <p className="text-xs text-zinc-700">Condition: {row.applies_when}</p>}
                  {row.description && <p className="text-xs text-zinc-600">{row.description}</p>}
                  {row.verified_at && row.verification_status === 'verified' && (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Verified {row.verified_at.slice(0, 10)} by {row.verified_by ? reviewers.get(row.verified_by) : 'unknown reviewer'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {status !== 'retired' && <VerifyButton requirementId={row.id} again={status !== 'pending'} />}
                  <RetireButton requirementId={row.id} retired={status === 'retired'} />
                </div>
              </div>
              {status !== 'retired' && (
                <EditRequirementForm requirementId={row.id} title={row.title} description={row.description} appliesWhen={row.applies_when} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
