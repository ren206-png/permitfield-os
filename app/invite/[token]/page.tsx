import Link from 'next/link';
import { PRODUCT_NAME } from '@/lib/brand';
import { createServiceClient } from '@/lib/supabase/service-client';
import { createClient } from '@/lib/supabase/server';
import { hashInviteToken, INVITE_TOKEN_PATTERN, ROLE_LABELS } from '@/lib/team/team';
import { AcceptInvitationForm } from './accept-invitation-form';
import { signOutForInvitationAction } from './actions';

// The page an invitee opens from their email (20260806000074). Reachable
// signed out, so it can say who invited them and ask them to sign in; the
// token is the only credential and is looked up by its hash. Accepting still
// requires signing in as the invited address (accept_org_invitation()).
export const dynamic = 'force-dynamic';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-md">
        <p className="text-center text-sm font-semibold text-zinc-900">{PRODUCT_NAME}</p>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-zinc-900">This invitation isn’t valid</h1>
      <p className="mt-2 text-sm text-zinc-600">It may have expired, been replaced by a newer one, or already been used. Ask the person who invited you to send a new one.</p>
    </Shell>
  );
}

function hasExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!INVITE_TOKEN_PATTERN.test(token)) return <Unavailable />;

  // Service-role read, scoped by the token's hash (lib/supabase/service-client.ts,
  // Exception 2: the bearer token is the authorization).
  const { data: invitation } = await createServiceClient()
    .from('org_invitations')
    .select('email, role, expires_at, accepted_at, revoked_at, organizations ( name )')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();
  if (!invitation || invitation.revoked_at || invitation.accepted_at || hasExpired(invitation.expires_at)) {
    return <Unavailable />;
  }
  const organization = Array.isArray(invitation.organizations) ? invitation.organizations[0] : invitation.organizations;
  const organizationName = organization?.name ?? 'the organization';
  const roleLabel = (ROLE_LABELS[invitation.role] ?? invitation.role).toLowerCase();

  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-zinc-900">Join {organizationName}</h1>
      <p className="mt-2 text-sm text-zinc-600">
        You’ve been invited as {roleLabel}. The invitation is for <span className="font-medium text-zinc-900">{invitation.email}</span>.
      </p>
      <div className="mt-5">
        {!user ? (
          <div className="flex flex-col gap-2 text-sm">
            <Link href={`/login?next=${next}`} className="self-start rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white hover:bg-zinc-800">
              Sign in or create an account
            </Link>
            <p className="text-xs text-zinc-500">
              Use {invitation.email}. If you create a new account and have to confirm your email first, come back to this link afterwards.
            </p>
          </div>
        ) : user.email?.toLowerCase() === invitation.email ? (
          <AcceptInvitationForm token={token} organizationName={organizationName} />
        ) : (
          <div className="flex flex-col gap-2 text-sm text-zinc-700">
            <p>
              You’re signed in as {user.email}. Sign out, then sign in as {invitation.email} to accept.
            </p>
            <form action={signOutForInvitationAction}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </Shell>
  );
}
