'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/org-context';
import { adminEmails } from '@/lib/auth/admin';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { GENERATED_BUCKET, UPLOADS_BUCKET } from '@/lib/storage/documents';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

export type DeleteAccountState = { error?: string };

const DELETE_CONFIRMATION = 'DELETE';

// Removes every file stored under one deleted company: <orgId>/<applicationId>/<file>
// in both buckets (lib/storage/documents.ts buildStoragePath).
async function removeCompanyFiles(service: ReturnType<typeof createServiceClient>, orgId: string): Promise<void> {
  for (const bucket of [UPLOADS_BUCKET, GENERATED_BUCKET]) {
    const storage = service.storage.from(bucket);
    const { data: folders } = await storage.list(orgId, { limit: 1000 });
    for (const folder of folders ?? []) {
      const prefix = `${orgId}/${folder.name}`;
      const { data: files } = await storage.list(prefix, { limit: 1000 });
      const paths = (files ?? []).map((file) => `${prefix}/${file.name}`);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await storage.remove(paths.slice(i, i + 100));
        if (error) console.error(`deleteAccount: could not remove files in ${bucket}/${prefix}: ${error.message}`);
      }
    }
  }
}

// Settings -> Security -> Delete account. The database work is one
// transaction in delete_account() (20260806000090); this action checks the
// confirmation, runs it for the caller's own user id (service client,
// lib/supabase/service-client.ts Exception 7), removes the deleted companies'
// files, and signs the person out.
export async function deleteAccountAction(_previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  if (String(formData.get('confirm') ?? '').trim() !== DELETE_CONFIRMATION) {
    return { error: `Type ${DELETE_CONFIRMATION} in capitals to confirm.` };
  }
  const user = await requireUser();
  if (adminEmails().includes((user.email ?? '').toLowerCase())) {
    return { error: "Platform admin accounts can't be deleted from here." };
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('delete_account', { p_user_id: user.id });
  if (error) {
    const reason = /^sole_owner: (.+)$/.exec(error.message)?.[1];
    if (reason) return { error: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` };
    console.error(`deleteAccount: delete_account failed for ${user.id}: ${error.message}`);
    return { error: `Your account couldn't be deleted. Please email ${SUPPORT_EMAIL} and we'll do it for you.` };
  }

  const deletedOrgs = ((data as { deleted_orgs?: string[] } | null)?.deleted_orgs ?? []) as string[];
  for (const orgId of deletedOrgs) {
    await removeCompanyFiles(service, orgId);
  }

  // The session's user is gone; this just clears the cookies.
  await (await createClient()).auth.signOut().catch(() => undefined);
  redirect('/login?deleted=1');
}
