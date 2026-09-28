import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS } from '@/lib/team/team';
import { switchOrganizationAction } from './actions';
import { InviteForm, MemberRoleForm, RevokeInvitationButton } from './team-controls';

// Team settings (20260806000074_org_invitations.sql). Every member sees the
// roster; owners also invite, change roles, remove people and see pending
// invitations (org_invitations RLS is owner-only).

interface MemberRow {
  member_id: string;
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

function hasExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export default async function TeamSettingsPage() {
  const { orgId, orgName, userId, role } = await requireOrgContext();
  const supabase = await createClient();
  const isOwner = role === 'owner';

  const [{ data: members, error: membersError }, { data: invitations }, { data: myOrgs }] = await Promise.all([
    supabase.rpc('list_org_members', { p_org_id: orgId }),
    isOwner
      ? supabase
          .from('org_invitations')
          .select('id, email, role, created_at, expires_at')
          .eq('org_id', orgId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as InvitationRow[] }),
    supabase.from('org_members').select('org_id, organizations ( name )').eq('user_id', userId).order('created_at', { ascending: true }),
  ]);
  if (membersError) {
    throw new Error(`Failed to load the team: ${membersError.message}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">Team</h1>
      <p className="mt-1 text-sm text-zinc-600">Everyone who works on {orgName}&apos;s applications.</p>

      {isOwner && (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Invite someone</h2>
          <p className="mt-1 text-xs text-zinc-500">They get an email link, valid for 7 days, and sign in with that email address to join.</p>
          <div className="mt-3">
            <InviteForm />
          </div>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Members</h2>
        <ul className="mt-2 flex flex-col divide-y divide-zinc-100">
          {((members ?? []) as MemberRow[]).map((member) => (
            <li key={member.member_id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-900">
                  {member.email}
                  {member.user_id === userId && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {ROLE_LABELS[member.role] ?? member.role} · joined {new Date(member.joined_at).toLocaleDateString('en-CA')}
                </p>
              </div>
              {isOwner && <MemberRoleForm memberId={member.member_id} role={member.role} isSelf={member.user_id === userId} />}
            </li>
          ))}
        </ul>
      </section>

      {(myOrgs ?? []).length > 1 && (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Your organizations</h2>
          <ul className="mt-2 flex flex-col divide-y divide-zinc-100">
            {(myOrgs ?? []).map((membership) => {
              const org = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
              return (
                <li key={membership.org_id} className="flex items-center justify-between py-2 text-sm text-zinc-900">
                  {org?.name ?? 'Organization'}
                  {membership.org_id === orgId ? (
                    <span className="text-xs text-zinc-500">current</span>
                  ) : (
                    <form action={switchOrganizationAction}>
                      <input type="hidden" name="orgId" value={membership.org_id} />
                      <button type="submit" className="text-xs font-medium text-zinc-900 underline underline-offset-2">
                        Switch
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isOwner && (invitations ?? []).length > 0 && (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Pending invitations</h2>
          <ul className="mt-2 flex flex-col divide-y divide-zinc-100">
            {((invitations ?? []) as InvitationRow[]).map((invitation) => {
              const expired = hasExpired(invitation.expires_at);
              return (
                <li key={invitation.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-900">{invitation.email}</p>
                    <p className="text-xs text-zinc-500">
                      {ROLE_LABELS[invitation.role] ?? invitation.role} ·{' '}
                      {expired ? 'expired -- invite again to send a new link' : `expires ${new Date(invitation.expires_at).toLocaleDateString('en-CA')}`}
                    </p>
                  </div>
                  <RevokeInvitationButton invitationId={invitation.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
