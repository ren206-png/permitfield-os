import { requireAdmin } from '@/lib/auth/admin';
import { createServiceClient } from '@/lib/supabase/service-client';
import { listTokensForApplication } from '@/lib/bridge/client-portal';
import { isClientPortalEnabled } from '@/lib/flags';
import { IssueTokenForm } from './issue-token-form';
import { RevokeTokenButton } from './revoke-token-button';

// Staff-facing client-portal token issuance/revocation, added after Gate
// 2.0/2.5 filled the gap GATE_2_0_SPEC.md §7 explicitly left open (see
// lib/bridge/client-portal.ts's "STAFF-FACING OPERATIONS" header comment for
// the two decisions made there -- 14-day default TTL, admin-only gate).
// Cross-tenant by design, same as app/admin/page.tsx: requireAdmin() is the
// only authorization check, not an org-scoped one.
export default async function ClientPortalAdminPage() {
  await requireAdmin();

  const clientPortalEnabled = isClientPortalEnabled();

  const supabase = createServiceClient();
  const [orgsResult, applicationsResult] = await Promise.all([
    supabase.from('organizations').select('id, name'),
    supabase
      .from('permit_applications')
      .select('id, org_id, project_title, project_address')
      .order('created_at', { ascending: false }),
  ]);

  if (orgsResult.error) {
    throw new Error(`Failed to load organizations: ${orgsResult.error.message}`);
  }
  if (applicationsResult.error) {
    throw new Error(`Failed to load applications: ${applicationsResult.error.message}`);
  }

  const orgNameById = new Map((orgsResult.data ?? []).map((org) => [org.id, org.name]));
  const applications = applicationsResult.data ?? [];

  // N+1 across project 2 (one listTokensForApplication call per
  // application) -- acceptable for now: this is an internal, low-volume
  // admin tool, not a customer-facing path with a real scale requirement
  // yet. Revisit with a batched project-2 query (`.in('application_id',
  // [...])`) if that stops being true.
  const tokenEntries = clientPortalEnabled
    ? await Promise.all(
        applications.map(async (app) => {
          const result = await listTokensForApplication(app.id);
          return [app.id, 'error' in result ? [] : result] as const;
        })
      )
    : [];
  const tokensByApplication = new Map(tokenEntries);

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Client portal access tokens</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Issue or revoke a client-facing portal link for any application.
      </p>

      {!clientPortalEnabled && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <code>PERMITFIELD_FF_CLIENT_PORTAL</code> is currently off. Issuance is disabled here too, since a token
          issued while the flag is off could never be resolved by a recipient.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {applications.length === 0 ? (
          <p className="text-sm text-zinc-500">No applications yet.</p>
        ) : (
          applications.map((app) => {
            const tokens = tokensByApplication.get(app.id) ?? [];
            return (
              <div key={app.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <p className="font-medium text-zinc-900">{app.project_title}</p>
                <p className="text-xs text-zinc-500">
                  {orgNameById.get(app.org_id) ?? app.org_id} · {app.project_address}
                </p>

                {tokens.length > 0 && (
                  <table className="mt-3 min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="py-1 pr-4 font-medium">Recipient</th>
                        <th className="py-1 pr-4 font-medium">Status</th>
                        <th className="py-1 pr-4 font-medium">Issued</th>
                        <th className="py-1 pr-4 font-medium">Expires</th>
                        <th className="py-1 pr-4 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {tokens.map((token) => {
                        const effectivelyExpired = token.status === 'active' && new Date(token.expiresAt).getTime() <= Date.now();
                        return (
                          <tr key={token.id}>
                            <td className="py-1 pr-4 text-zinc-800">
                              {token.recipientName ? `${token.recipientName} <${token.recipientEmailDisplay}>` : token.recipientEmailDisplay}
                            </td>
                            <td className="py-1 pr-4 text-zinc-600">{effectivelyExpired ? 'expired' : token.status}</td>
                            <td className="py-1 pr-4 text-zinc-500">{new Date(token.issuedAt).toLocaleDateString()}</td>
                            <td className="py-1 pr-4 text-zinc-500">{new Date(token.expiresAt).toLocaleDateString()}</td>
                            <td className="py-1">
                              {token.status === 'active' && !effectivelyExpired ? <RevokeTokenButton tokenId={token.id} /> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {clientPortalEnabled && <IssueTokenForm applicationId={app.id} orgId={app.org_id} />}
              </div>
            );
          })
        )}
      </div>

      <p className="mt-8 text-xs text-zinc-400">
        Defaults: 14-day expiry, platform-admin-only issuance/revocation (this same <code>ADMIN_EMAILS</code> gate,
        not a new org-role tier). Both were explicitly undecided in <code>GATE_2_0_SPEC.md</code> §7 -- these are
        reasonable starting defaults, not a ratified product decision. Revisit if a real requirement (e.g. letting
        org owners self-serve this) shows up.
      </p>
    </div>
  );
}
