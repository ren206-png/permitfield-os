import { adminEmails } from '@/lib/auth/admin';
import { createServiceClient } from '@/lib/supabase/service-client';
import { foundingRank } from './founding';

// The caller's organization's founding place (1-10), or null. Reads every
// organization's creation order and which ones have a platform admin as a
// member, so it needs the service client (lib/supabase/service-client.ts,
// Exception 6) -- but it returns nothing about other organizations, only
// this one number for the org the caller's own session resolved.
export async function getFoundingRank(orgId: string): Promise<number | null> {
  const service = createServiceClient();

  const { data: orgs, error: orgsError } = await service
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(500);
  if (orgsError || !orgs) {
    console.error(`getFoundingRank: organizations read failed: ${orgsError?.message}`);
    return null;
  }

  const internalOrgIds = new Set<string>();
  const admins = adminEmails();
  if (admins.length > 0) {
    const { data: userPage, error: usersError } = await service.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) {
      console.error(`getFoundingRank: user list failed: ${usersError.message}`);
      return null;
    }
    const adminUserIds = userPage.users.filter((user) => admins.includes((user.email ?? '').toLowerCase())).map((user) => user.id);
    if (adminUserIds.length > 0) {
      const { data: memberships, error: membersError } = await service.from('org_members').select('org_id').in('user_id', adminUserIds);
      if (membersError) {
        console.error(`getFoundingRank: org_members read failed: ${membersError.message}`);
        return null;
      }
      for (const membership of memberships ?? []) internalOrgIds.add(membership.org_id as string);
    }
  }

  return foundingRank(orgs as { id: string }[], internalOrgIds, orgId);
}
