import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isPublicApiEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createClient } from '@/lib/supabase/server';
import { CreateKeyForm } from './create-key-form';
import { RevokeButton } from './revoke-button';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default async function ApiKeysPage() {
  if (!isPublicApiEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'api.access');
  const supabase = await createClient();

  // Authoritative role check (owner/org_owner/platform_admin); OrgContext's
  // role type only models the legacy owner/member pair.
  const { data: canManage } = await supabase.rpc('can_manage_api_keys', { check_org_id: orgId });

  let keys: ApiKeyRow[] = [];
  let loadError: string | null = null;
  if (hasEntitlement && canManage) {
    const { data, error } = await supabase
      .from('org_api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) {
      loadError = error.message;
    } else {
      keys = data ?? [];
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">API keys</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Read your organization’s projects and permit applications from other tools. Keys are read-only and see
        everything in this organization, so treat them like passwords.{' '}
        <a href="/api/v1/openapi.json" className="font-medium text-zinc-900 underline underline-offset-2">
          API reference (OpenAPI)
        </a>
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {!hasEntitlement ? (
          <p className="text-sm text-zinc-600">
            Your organization’s plan does not include API access. Upgrade your plan to turn this on.
          </p>
        ) : !canManage ? (
          <p className="text-sm text-zinc-600">Only organization owners can create and manage API keys.</p>
        ) : (
          <>
            <CreateKeyForm />

            <h2 className="mt-8 text-sm font-semibold text-zinc-900">Your keys</h2>
            {loadError ? (
              <p className="mt-2 text-sm text-red-600">Couldn’t load keys: {loadError}</p>
            ) : keys.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No API keys yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100">
                {keys.map((key) => (
                  <li key={key.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{key.name}</p>
                      <p className="text-xs text-zinc-500">
                        <code className="font-mono">{key.key_prefix}…</code> · Created{' '}
                        {new Date(key.created_at).toLocaleDateString()} ·{' '}
                        {key.last_used_at
                          ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                          : 'Never used'}
                      </p>
                    </div>
                    {key.revoked_at ? (
                      <span className="text-xs font-medium text-zinc-500">
                        Revoked {new Date(key.revoked_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <RevokeButton keyId={key.id} keyName={key.name} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
