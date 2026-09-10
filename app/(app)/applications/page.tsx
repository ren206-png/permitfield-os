import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { centsToDollarsString } from '@/lib/money/cents';
import { StatusBadge } from '@/components/status-badge';
import { CoverageBadge } from '@/components/coverage-badge';
import { fetchAllRows } from '@/lib/supabase/paginate';

interface JurisdictionRow {
  municipality: string;
  province_code: string;
  coverage_level: string;
}
interface PermitTypeRow {
  title: string;
  jurisdictions: JurisdictionRow | JurisdictionRow[] | null;
}
interface ApplicationListRow {
  id: string;
  project_title: string;
  project_address: string;
  status: string;
  estimated_job_value_cents: number | null;
  currency_code: string;
  created_at: string;
  permit_types: PermitTypeRow | PermitTypeRow[] | null;
}

export default async function ApplicationsPage() {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  // RLS (`permit_applications_select`, is_org_member(org_id)) already scopes
  // this to the caller's org -- the explicit .eq('org_id', orgId) below is
  // redundant with RLS but kept anyway so this query reads correctly on its
  // own and doesn't rely on a reader knowing RLS exists, matching how
  // app/api/documents/route.ts still re-derives orgId from a lookup rather
  // than trusting a client-supplied value.
  //
  // Health-check audit round 3 finding: a plain .select() here has no
  // .range()/pagination guard, so any org with more than PostgREST's default
  // 1000-row cap (`db max rows`) would have silently had its oldest
  // applications cut off the list with no error -- the exact failure mode
  // lib/supabase/paginate.ts's header comment documents and that app/admin/
  // page.tsx and lib/jurisdictions/public-directory.ts already guard against.
  // fetchAllRows loops .range() pages (ordered by created_at, same order as
  // before) until a short page confirms there's no more data.
  const applications = await fetchAllRows<ApplicationListRow>(
    (from, to) =>
      supabase
        .from('permit_applications')
        .select(
          `id, project_title, project_address, status, estimated_job_value_cents, currency_code, created_at,
           permit_types ( title, jurisdictions ( municipality, province_code, coverage_level ) )`
        )
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to),
    'applications'
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Applications</h1>
        <Link
          href="/applications/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          New application
        </Link>
      </div>

      {applications && applications.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {applications.map((app) => {
            const permitType = Array.isArray(app.permit_types) ? app.permit_types[0] : app.permit_types;
            const jurisdiction = permitType
              ? Array.isArray(permitType.jurisdictions)
                ? permitType.jurisdictions[0]
                : permitType.jurisdictions
              : null;
            return (
              <li key={app.id}>
                <Link
                  href={`/applications/${app.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-zinc-900">{app.project_title}</p>
                      <p className="mt-0.5 text-sm text-zinc-500">{app.project_address}</p>
                      <p className="mt-1 text-sm text-zinc-600">
                        {permitType?.title ?? 'Unknown permit type'}
                        {jurisdiction && (
                          <>
                            {' '}
                            — {jurisdiction.municipality}, {jurisdiction.province_code}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <StatusBadge status={app.status} />
                      {jurisdiction && <CoverageBadge coverageLevel={jurisdiction.coverage_level} />}
                    </div>
                  </div>
                  {app.estimated_job_value_cents != null && (
                    <p className="mt-2 text-sm text-zinc-500">
                      Estimated job value: {centsToDollarsString(BigInt(app.estimated_job_value_cents))}{' '}
                      {app.currency_code}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No applications yet.</p>
          <Link href="/applications/new" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Start your first application
          </Link>
        </div>
      )}
    </div>
  );
}
