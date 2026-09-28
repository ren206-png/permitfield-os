'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ACTIVE_ORG_COOKIE, requireOrgContext } from '@/lib/auth/org-context';
import { sendEmail } from '@/lib/email/send';
import { renderOrgInvitationEmail } from '@/lib/email/templates/org-invitation';
import { SITE_URL } from '@/lib/seo';
import { createClient } from '@/lib/supabase/server';
import { generateInviteToken, hashInviteToken, isAssignableRole, ROLE_LABELS, teamErrorMessage } from '@/lib/team/team';

// Team settings actions. Every rule (owner-only, assignable roles, at least
// one owner) is enforced by the functions in 20260806000074; these only
// shape input and report back.

export interface TeamActionState {
  error?: string;
  message?: string;
  inviteUrl?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function inviteMemberAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const { orgId, orgName } = await requireOrgContext();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '');
  if (!EMAIL_PATTERN.test(email) || email.length > 320) return { error: 'Enter a valid email address.' };
  if (!isAssignableRole(role)) return { error: 'Choose a role.' };

  const supabase = await createClient();
  const token = generateInviteToken();
  const { error } = await supabase.rpc('invite_org_member', {
    p_org_id: orgId,
    p_email: email,
    p_role: role,
    p_token_hash: hashInviteToken(token),
  });
  if (error) return { error: teamErrorMessage(error.message) };

  const inviteUrl = `${SITE_URL}/invite/${token}`;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sent = await sendEmail(
    renderOrgInvitationEmail({
      recipientEmail: email,
      organizationName: orgName,
      inviterEmail: user?.email ?? null,
      roleLabel: ROLE_LABELS[role],
      acceptUrl: inviteUrl,
    })
  );

  revalidatePath('/settings/team');
  return sent.success
    ? { message: `Invitation emailed to ${email}.`, inviteUrl }
    : { message: `Invitation created, but the email didn't send (${sent.error.replace(/\.$/, '')}). Copy the link below and send it yourself.`, inviteUrl };
}

export async function revokeInvitationAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await requireOrgContext();
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!UUID_PATTERN.test(invitationId)) return { error: 'Invalid invitation.' };
  const { error } = await (await createClient()).rpc('revoke_org_invitation', { p_invitation_id: invitationId });
  revalidatePath('/settings/team');
  return error ? { error: teamErrorMessage(error.message) } : { message: 'Invitation revoked. The link no longer works.' };
}

export async function changeRoleAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await requireOrgContext();
  const memberId = String(formData.get('memberId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!UUID_PATTERN.test(memberId) || !isAssignableRole(role)) return { error: 'Invalid change.' };
  const { error } = await (await createClient()).rpc('update_org_member_role', { p_member_id: memberId, p_role: role });
  revalidatePath('/settings/team');
  return error ? { error: teamErrorMessage(error.message) } : { message: 'Role updated.' };
}

export async function removeMemberAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await requireOrgContext();
  const memberId = String(formData.get('memberId') ?? '');
  if (!UUID_PATTERN.test(memberId)) return { error: 'Invalid member.' };
  const { error } = await (await createClient()).rpc('remove_org_member', { p_member_id: memberId });
  revalidatePath('/settings/team');
  return error ? { error: teamErrorMessage(error.message) } : { message: 'Removed from the team.' };
}

// Switches which organization the app opens for someone in more than one.
// The cookie is only a hint -- requireOrgContext() ignores it unless the user
// is a member -- but it is checked here too so a bad value is never stored.
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const orgId = String(formData.get('orgId') ?? '');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !UUID_PATTERN.test(orgId)) redirect('/settings/team');
  const { data: membership } = await supabase.from('org_members').select('org_id').eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
  if (membership) {
    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/applications');
}
