import { requireAdmin } from '@/lib/auth/admin';
import { createServiceClient } from '@/lib/supabase/service-client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { User } from '@supabase/supabase-js';

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
}
interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: string;
}
interface ContractorRow {
  org_id: string;
  company_name: string;
}
interface ApplicationRow {
  id: string;
  org_id: string;
  status: string;
}

// Cross-tenant platform overview. Deliberately the only page in this
// codebase that queries organizations/org_members/contractors/
// permit_applications without an .eq('org_id', ...) filter -- it uses
// createServiceClient() (service_role, bypasses RLS) rather than the
// per-request cookie client every other page uses, because there is no
// single org to scope to here by design. requireAdmin() (both the feature
// flag and the ADMIN_EMAILS allowlist) already ran before this component's
// body executes, so reaching this point means the caller is explicitly
// authorized to see every tenant's data.

// listUsers() paginates server-side (max 1000/page per the Supabase Admin
// API) -- a single `perPage: 1000` call silently truncates once the
// platform has more than 1000 registered users, with no error and no
// indication anything was cut off. Pages through until a short page comes
// back, same "don't trust a single page as the whole result" discipline
// this codebase already applies to DB queries.
async function listAllUsers(supabase: ReturnType<typeof createServiceClient>): Promise<User[]> {
  const perPage = 1000;
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to load users: ${error.message}`);
    }
    users.push(...data.users);
    if (data.users.length < perPage) {
      break;
    }
  }
  return users;
}

// Same silent-truncation risk as listAllUsers() above, but for PostgREST
// rather than the Admin API: Supabase's default `db max rows` config caps a
// single .select() response at 1000 rows with no error and no indication
// anything was cut off. This page's four table queries are the only ones in
// the codebase with no .eq('org_id', ...) filter (see header comment) --
// every other page's queries are implicitly bounded to one tenant's rows,
// so this is the one place a genuinely unbounded scan could quietly lose
// rows once the platform grows past 1000 orgs/members/contractors/
// applications. Pages via .range() until a short page comes back, ordered
// by a column (set) that's unique or effectively so per table, since
// .range() pagination without a deterministic ORDER BY can skip or repeat
// rows across pages. Shared implementation: lib/supabase/paginate.ts.

export default async function AdminPage() {
  await requireAdmin();

  const supabase = createServiceClient();

  const [orgs, members, contractors, applications, users] = await Promise.all([
    fetchAllRows<OrgRow>(
      (from, to) =>
        supabase
          .from('organizations')
          .select('id, name, created_at')
          .order('created_at', { ascending: false })
          .range(from, to),
      'organizations'
    ),
    fetchAllRows<OrgMemberRow>(
      (from, to) =>
        supabase.from('org_members').select('org_id, user_id, role').order('org_id').order('user_id').range(from, to),
      'org members'
    ),
    fetchAllRows<ContractorRow>(
      (from, to) => supabase.from('contractors').select('org_id, company_name').order('org_id').range(from, to),
      'contractors'
    ),
    fetchAllRows<ApplicationRow>(
      (from, to) => supabase.from('permit_applications').select('id, org_id, status').order('id').range(from, to),
      'applications'
    ),
    listAllUsers(supabase),
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  // Registered users previously had no way to tell whether a signed-up
  // auth.users row actually belongs to any organization -- org_members was
  // already being fetched above (for the Organizations table's owner
  // lookup) but never joined back onto the per-user rows below. A user with
  // zero entries here signed up but never created/joined an org (e.g.
  // abandoned onboarding, or an invite that was never accepted) -- surfaced
  // explicitly rather than left indistinguishable from an active member.
  const membershipsByUserId = new Map<string, { orgName: string; role: string }[]>();
  for (const member of members) {
    const list = membershipsByUserId.get(member.user_id) ?? [];
    list.push({ orgName: orgNameById.get(member.org_id) ?? member.org_id, role: member.role });
    membershipsByUserId.set(member.user_id, list);
  }
  const usersWithNoOrg = users.filter((u) => !membershipsByUserId.has(u.id)).length;

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
      <p className="mt-1 text-sm text-zinc-500">
        {usersWithNoOrg > 0
          ? `${usersWithNoOrg} user${usersWithNoOrg === 1 ? '' : 's'} signed up but never joined or created an organization.`
          : 'Every registered user belongs to at least one organization.'}
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Organization(s)</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Confirmed</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Last sign-in</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map((u) => {
              const memberships = membershipsByUserId.get(u.id) ?? [];
              return (
                <tr key={u.id}>
                  <td className="px-4 py-2 font-medium text-zinc-900">{u.email ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {memberships.length > 0 ? (
                      memberships.map((m) => `${m.orgName} (${m.role})`).join(', ')
                    ) : (
                      <span className="text-amber-700">No organization</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-600">{u.email_confirmed_at ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2 text-zinc-500">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
