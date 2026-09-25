'use server';

import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isPublicApiEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import { generateApiKey } from '@/lib/public-api/keys';
import { isUuid } from '@/lib/public-api/pagination';

// Authorization is enforced by org_api_keys' RLS (can_manage_api_keys():
// owner/org_owner/platform_admin), not by anything in this file -- a
// member outside that set gets an RLS violation on insert, or zero rows
// updated on revoke, and sees a plain message.

export interface CreateApiKeyState {
  error?: string;
  // The plaintext key, returned exactly once. It is never stored and cannot
  // be retrieved again.
  createdKey?: string;
  createdName?: string;
}

export async function createApiKeyAction(prevState: CreateApiKeyState, formData: FormData): Promise<CreateApiKeyState> {
  void prevState;
  if (!isPublicApiEnabled()) {
    return { error: 'The public API is currently off.' };
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'api.access'))) {
    return { error: 'Your organization’s plan does not include API access.' };
  }

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 100) {
    return { error: 'Give the key a name between 1 and 100 characters.' };
  }

  const generated = generateApiKey();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_api_keys')
    .insert({
      org_id: orgId,
      name,
      key_prefix: generated.prefix,
      key_hash: generated.hash,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '42501') {
      return { error: 'Only organization owners can create API keys.' };
    }
    return { error: `Failed to create API key: ${error.message}` };
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId,
    actorUserId: userId,
    actorRole: role,
    action: 'api_key.created',
    entityType: 'org_api_keys',
    entityId: data.id,
    afterSummary: { name, key_prefix: generated.prefix },
  });
  if (auditError) {
    console.error('Failed to write audit log for api_key.created:', auditError);
  }

  revalidatePath('/settings/api-keys');
  return { createdKey: generated.key, createdName: name };
}

export interface RevokeApiKeyState {
  error?: string;
}

export async function revokeApiKeyAction(prevState: RevokeApiKeyState, formData: FormData): Promise<RevokeApiKeyState> {
  void prevState;
  if (!isPublicApiEnabled()) {
    return { error: 'The public API is currently off.' };
  }

  const keyId = String(formData.get('keyId') ?? '');
  if (!isUuid(keyId)) {
    return { error: 'Invalid key.' };
  }

  const { orgId, userId, role } = await requireOrgContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .select('id, name, key_prefix');

  if (error) {
    return { error: `Failed to revoke API key: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { error: 'That key was not found, is already revoked, or you do not have permission to revoke it.' };
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId,
    actorUserId: userId,
    actorRole: role,
    action: 'api_key.revoked',
    entityType: 'org_api_keys',
    entityId: keyId,
    afterSummary: { name: data[0].name, key_prefix: data[0].key_prefix },
  });
  if (auditError) {
    console.error('Failed to write audit log for api_key.revoked:', auditError);
  }

  revalidatePath('/settings/api-keys');
  return {};
}
