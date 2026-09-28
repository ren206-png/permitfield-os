import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { needsMfaChallenge } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/server';
import { MfaChallengeForm } from './mfa-challenge-form';

// The second sign-in step for someone with an authenticator app set up
// (lib/auth/mfa.ts). proxy.ts sends every signed-in page here until the code
// is entered.
export default async function MfaChallengePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: levels } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!needsMfaChallenge(levels)) redirect('/applications');

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">{PRODUCT_NAME}</h1>
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Enter your authenticator code</h2>
          <p className="mt-1 text-sm text-zinc-600">Open the authenticator app you set up for {user.email} and enter the 6-digit code.</p>
          <div className="mt-4">
            <MfaChallengeForm />
          </div>
        </div>
      </div>
    </div>
  );
}
