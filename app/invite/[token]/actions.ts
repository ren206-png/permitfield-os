'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACTIVE_ORG_COOKIE } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { hashInviteToken, INVITE_TOKEN_PATTERN, teamErrorMessage } from '@/lib/team/team';

export interface AcceptInvitationState {
  error?: string;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Joins as the signed-in user; accept_org_invitation() checks the token,
// expiry and that the account email is the invited one. The new org becomes
// the one the app opens.
export async function acceptInvitationAction(_prev: AcceptInvitationState, formData: FormData): Promise<AcceptInvitationState> {
  const token = String(formData.get('token') ?? '');
  if (!INVITE_TOKEN_PATTERN.test(token)) return { error: 'This invitation is no longer valid. Ask for a new one.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data: orgId, error } = await supabase.rpc('accept_org_invitation', { p_token_hash: hashInviteToken(token) });
  if (error || typeof orgId !== 'string') return { error: teamErrorMessage(error?.message ?? '') };

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: ONE_YEAR_SECONDS });
  redirect('/applications');
}

export async function signOutForInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  await (await createClient()).auth.signOut();
  redirect(INVITE_TOKEN_PATTERN.test(token) ? `/login?next=${encodeURIComponent(`/invite/${token}`)}` : '/login');
}
