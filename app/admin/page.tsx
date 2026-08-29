import { requireAdmin } from '@/lib/auth/admin';
import { createServiceClient } from '@/lib/supabase/service-client';

// Cross-tenant platform overview. Deliberately the only page in this
// codebase that queries organizations/org_members/contractors/
// permit_applications without an .eq('org_id', ...) filter -- it uses
// createServiceClient() (service_role, bypasses RLS) rather than the
// per-request cookie client every other page uses, because there is no
// single org to scope to here by design. requireAdmin() (both the feature
// flag and the ADMIN_EMAILS allowlist) already ran before this component's
// body executes, so reaching this point means the caller is explicitly
// authorized to see every tenant's data.
export default async function AdminPage() {
  await requireAdmin();

  const supabase = createServiceClient();

  const [orgsResult, membersResult, contractorsResult, applicationsResult, usersResult] = await Promise.all([
    supabase.from('organizations').select('id, name, created_at').order('created_at', { ascending: false }),
    supabase.from('org_members').select('org_id, user_id, role'),
    supabase.from('contractors').select('org_id, company_name'),
    supabase.from('permit_applications').select('id, org_id, status'),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (orgsResult.error) {
    throw new Error(`Failed to load organizations: ${orgsResult.error.message}`);
  }
  if (membersResult.error) {
    throw new Error(`Failed to load org members: ${membersResult.error.message}`);
  }
  if (contractorsResult.error) {
    throw new Error(`Failed to load contractors: ${contractorsResult.error.message}`);
  }
  if (applicationsResult.error) {
    throw new Error(`Failed to load applications: ${applicationsResult.error.message}`);
  }
  if (usersResult.error) {
    throw new Error(`Failed to load users: ${usersResult.error.message}`);
  }

  const usersById = new Map(usersResult.data.users.map((u) => [u.id, u]));
  const orgs = orgsResult.data ?? [];
  const members = membersResult.data ?? [];
  const contractors = contractorsResult.data ?? [];
  const applications = applicationsResult.data ?? [];

  const rows = orgs.map((org) => {
    const orgMembers = members.filter((m) => m.org_id === org.id);
    const owner = orgMembers.find((m) => m.role === 'owner');
    const ownerEmail = owner ? (usersById.get(owner.user_id)?.email ?? owner.user_id) : '—';
    const contractor = contractors.find((c) => c.org_id === org.id);
    const orgApplications = applications.filter((a) => a.org_id === org.id);

    return {
      id: org.id,
      name: org.name,
      createdAt: org.created_at,
      ownerEmail,
      memberCount: orgMembers.length,
      contractorCompany: contractor?.company_name ?? '—',
      applicationCount: orgApplications.length,
    };
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Organizations</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {orgs.length} organization{orgs.length === 1 ? '' : 's'} · {usersById.size} registered user
        {usersById.size === 1 ? '' : 's'} · {applications.length} application{applications.length === 1 ? '' : 's'}
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Organization</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Owner</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Members</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Contractor</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Applications</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 font-medium text-zinc-900">{row.name}</td>
                  <td className="px-4 py-2 text-zinc-600">{row.ownerEmail}</td>
                  <td className="px-4 py-2 text-zinc-600">{row.memberCount}</td>
                  <td className="px-4 py-2 text-zinc-600">{row.contractorCompany}</td>
                  <td className="px-4 py-2 text-zinc-600">{row.applicationCount}</td>
                  <td className="px-4 py-2 text-zinc-500">{new Date(row.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  No organizations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-zinc-900">Registered users</h2>
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Confirmed</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Last sign-in</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {usersResult.data.users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-zinc-900">{u.email ?? '—'}</td>
                <td className="px-4 py-2 text-zinc-600">{u.email_confirmed_at ? 'Yes' : 'No'}</td>
                <td className="px-4 py-2 text-zinc-500">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-2 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
