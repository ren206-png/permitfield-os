'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MFA_CODE_PATTERN } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/client';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-[0.3em] text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';

export function MfaChallengeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!MFA_CODE_PATTERN.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === 'verified');
    if (factorsError || !factor) {
      setError('No authenticator app is set up on this account.');
      setPending(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verifyError) {
      setError('That code didn’t work. Codes change every 30 seconds -- try the current one.');
      setPending(false);
      return;
    }
    router.refresh();
    router.push('/applications');
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.push('/login');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        className={inputClass}
        aria-label="6-digit code"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Checking…' : 'Verify'}
      </button>
      <button type="button" onClick={() => void handleSignOut()} className="text-sm text-zinc-600 underline underline-offset-2">
        Sign out
      </button>
    </form>
  );
}
