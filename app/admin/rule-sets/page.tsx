import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service-client';

// Rule sets (Gate 6.3): per permit type, the newest published version that
// the 6.2 rule engine evaluates, and how many verified requirements exist to
// publish from.

interface PermitTypeRow {
  id: string;
  title: string;
  jurisdictions: { municipality: string | null; province_code: string } | { municipality: string | null; province_code: string }[] | null;
}

export default async function RuleSetsPage() {
  await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();

  const supabase = createServiceClient();
  // Paged: PostgREST's row cap would otherwise truncate silently.
  const [types, requirements, versions] = await Promise.all([
    fetchAllRows<PermitTypeRow>(
      (from, to) => supabase.from('permit_types').select('id, title, jurisdictions ( municipality, province_code )').order('id').range(from, to),
      'permit types'
    ),
    fetchAllRows<{ permit_type_id: string }>(
      (from, to) =>
        supabase.from('permit_requirements').select('permit_type_id').eq('verification_status', 'verified').is('archived_at', null).order('id').range(from, to),
      'requirements'
    ),
    fetchAllRows<{ permit_type_id: string; version: number; published_at: string }>(
      (from, to) => supabase.from('rule_set_versions').select('permit_type_id, version, published_at').order('version', { ascending: false }).order('id').range(from, to),
      'rule set versions'
    ),
  ]);

  const verifiedCount = new Map<string, number>();
  for (const r of requirements) verifiedCount.set(r.permit_type_id, (verifiedCount.get(r.permit_type_id) ?? 0) + 1);
  const latest = new Map<string, { version: number; published_at: string }>();
  for (const v of versions) if (!latest.has(v.permit_type_id)) latest.set(v.permit_type_id, v);

  const rows = types
    .filter((t) => verifiedCount.has(t.id) || latest.has(t.id))
    .map((t) => {
      const j = Array.isArray(t.jurisdictions) ? t.jurisdictions[0] : t.jurisdictions;
      return { ...t, place: j ? `${j.municipality ?? 'Province-wide'}, ${j.province_code}` : '' };
    })
    .sort((a, b) => a.place.localeCompare(b.place) || a.title.localeCompare(b.title));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Rule sets</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          A rule set is a frozen copy of a permit type&apos;s verified requirements, with optional conditions. Publishing never changes an earlier
          version. With no rule set, every requirement is reported as &ldquo;unknown&rdquo; rather than &ldquo;not required&rdquo;.
        </p>
      </div>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {rows.map((t) => {
          const v = latest.get(t.id);
          return (
            <li key={t.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Link href={`/admin/rule-sets/${t.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                  {t.place} · {t.title}
                </Link>
                <div className="text-xs text-zinc-500">{verifiedCount.get(t.id) ?? 0} verified requirements</div>
              </div>
              <div className="text-xs text-zinc-600">
                {v ? (
                  <>
                    Version {v.version} · <LocalTime value={v.published_at} dateOnly />
                  </>
                ) : (
                  'No rule set published'
                )}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-6 text-center text-sm text-zinc-500">No permit type has verified requirements yet.</li>}
      </ul>
    </div>
  );
}
