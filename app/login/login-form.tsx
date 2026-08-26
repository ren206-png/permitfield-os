'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);

    const supabase = createClient();
    // Password auth only. NOTE: this used to assume every environment has
    // email confirmation off, matching supabase/config.toml's local dev
    // config (`enable_confirmations = false`). That assumption does NOT
    // hold in production -- the deployed Supabase project has
    // `mailer_autoconfirm: false` (confirmed via a GET to its public
    // /auth/v1/settings endpoint), meaning sign-up there requires a real
    // email confirmation round trip before a session exists. Previously
    // this function couldn't tell the two cases apart: signUp() returns no
    // `error` either way, so on a confirmation-required project the code
    // fell through to router.push('/applications') with no session cookie
    // ever set, which proxy.ts's own auth guard then bounces straight back
    // to /login -- from the user's perspective this looked like the
    // "Please wait…" button hanging forever (worse, if the mailer itself is
    // slow/misconfigured, the signUp() call can also just take a long time
    // to resolve). Checking `data.session` below distinguishes "signed up,
    // already live" (local/confirmation-off) from "signed up, check your
    // email" (production/confirmation-on) instead of assuming the former.
    const { data, error: authError } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setPending(false);
      return;
    }

    if (mode === 'sign-up' && !data.session) {
      // Account created, but this project requires email confirmation and
      // no session was issued yet -- stop here instead of navigating to a
      // route that will just redirect back once proxy.ts sees no user.
      setPending(false);
      setInfo('Check your email to confirm your account, then sign in.');
      return;
    }

    // router.refresh() re-runs Server Component data fetching (including
    // lib/auth/org-context.ts) against the now-live session cookie before
    // router.push() navigates, so /applications doesn't render a stale
    // signed-out state for one frame.
    router.refresh();
    router.push('/applications');
  }

  return (
    <div>
      <div className="mb-6 flex rounded-md border border-zinc-200 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode('sign-in')}
          className={`flex-1 rounded px-3 py-1.5 transition-colors ${
            mode === 'sign-in' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('sign-up')}
          className={`flex-1 rounded px-3 py-1.5 transition-colors ${
            mode === 'sign-up' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {info && (
          <p role="status" className="text-sm text-emerald-600">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
