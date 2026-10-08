import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { reviewCounts, type ReviewableRequirement } from '@/lib/requirements/review';
import { createServiceClient } from '@/lib/supabase/service-client';

// Requirements review, overview: every permit type's catalog requirements
// (migration 080) and how many a named reviewer has verified. Reference data,
// not tenant data, but writes are platform-admin only, so it lives in /admin
// behind requireAdmin() like the rest of this panel.

interface PermitTypeRow {
  id: string;
  title: string;
  jurisdictions: { municipality: string | null; province_code: string } | { municipality: string | null; province_code: string }[] | null;
}

interface RequirementRow extends ReviewableRequirement {
  permit_type_id: string;
}

export default async function RequirementsReviewPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const [{ data: permitTypes, error: typesError }, { data: requirements, error: reqError }] = await Promise.all([
    supabase.from('permit_types').select('id, title, jurisdictions ( municipality, province_code )'),
    supabase.from('permit_requirements').select('permit_type_id, verification_status, verified_at, archived_at'),
  ]);
  if (typesError || reqError) {
    throw new Error(`Failed to load requirements: ${(typesError ?? reqError)?.message}`);
  }

  const byType = new Map<string, RequirementRow[]>();
  for (const row of (requirements ?? []) as RequirementRow[]) {
    byType.set(row.permit_type_id, [...(byType.get(row.permit_type_id) ?? []), row]);
  }
  const rows = ((permitTypes ?? []) as PermitTypeRow[])
    .map((type) => {
      const jurisdiction = Array.isArray(type.jurisdictions) ? type.jurisdictions[0] : type.jurisdictions;
      const place = jurisdiction ? `${jurisdiction.municipality ?? jurisdiction.province_code}, ${jurisdiction.province_code}` : 'Unknown';
      return { id: type.id, place, title: type.title, counts: reviewCounts(byType.get(type.id) ?? []) };
    })
    .sort((a, b) => a.place.localeCompare(b.place));
  const all = reviewCounts((requirements ?? []) as RequirementRow[]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Requirements review</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600">
        Each city&apos;s submission requirements, copied from its published checklist. Open a city, compare each item with the
        source, and verify, edit or retire it. Contractors see which items are verified; anything not yet verified is marked as
        not reviewed. Verified items need checking again after 180 days.
      </p>
      <p className="mt-3 text-sm text-zinc-800">
        {all.verified} of {all.total - all.retired} active items verified
        {all.stale > 0 && <span className="text-amber-700"> · {all.stale} due for re-check</span>}
      </p>

      <table className="mt-4 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">City</th>
            <th className="px-3 py-2 font-medium">Permit type</th>
            <th className="px-3 py-2 font-medium">Verified</th>
            <th className="px-3 py-2 font-medium">Pending</th>
            <th className="px-3 py-2 font-medium">Re-check</th>
            <th className="px-3 py-2 font-medium">Retired</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2">
                <Link href={`/admin/requirements/${row.id}`} className="font-medium text-zinc-900 underline underline-offset-2">
                  {row.place}
                </Link>
              </td>
              <td className="px-3 py-2 text-zinc-700">{row.title}</td>
              <td className="px-3 py-2 text-emerald-700">{row.counts.verified}</td>
              <td className="px-3 py-2 text-zinc-700">{row.counts.pending}</td>
              <td className="px-3 py-2 text-amber-700">{row.counts.stale || ''}</td>
              <td className="px-3 py-2 text-zinc-500">{row.counts.retired || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
