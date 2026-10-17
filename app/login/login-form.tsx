'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from '@/lib/auth/oauth-providers';
import { Turnstile, TURNSTILE_SITE_KEY } from './turnstile';
import { nativeApp, useIsNativeApp } from '@/lib/native/app';

const inputClass =
  'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

// The /auth/callback URL a sign-in that leaves the site returns to, carrying
// the invitation (if any) through. Supabase only honours it when it is in the
// project's allowed redirect URLs; otherwise it falls back to the Site URL.
const MIN_PASSWORD_LENGTH = 10;

function callbackUrl(next: string | null): string {
  const url = new URL('/auth/callback', window.location.origin);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

export function LoginForm({
  next = null,
  providers = [],
  appleEnabled = false,
  initialMode = 'sign-in',
}: {
  next?: string | null;
  providers?: OAuthProvider[];
  appleEnabled?: boolean;
  // The homepage's "Create your account" buttons open on the sign-up tab.
  initialMode?: 'sign-in' | 'sign-up';
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set once a sign-up needs email confirmation (see the `!data.session`
  // branch below), so the "Resend confirmation email" affordance only shows
  // up in the state it's actually useful for, and knows which address to
  // resend to without trusting the (possibly since-edited) `email` field.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendPending, setResendPending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Cloudflare Turnstile token (single-use); see ./turnstile.tsx.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaMissing = TURNSTILE_SITE_KEY !== '' && !captchaToken;
  // "Forgot password?" swaps the form for a send-a-reset-link form.
  const [forgot, setForgot] = useState(false);
  // Google blocks its sign-in inside apps' web views, so the iPhone app
  // offers email (and Sign in with Apple) only; the website shows all.
  const isNativeApp = useIsNativeApp();
  const visibleProviders = isNativeApp ? [] : providers;
  const showApple = isNativeApp && appleEnabled;

  // Ticks the resend cooldown down to 0 once a resend has been sent, so the
  // button can't be mashed into re-triggering Supabase's own rate limit
  // (which would just surface as an opaque error) -- 60s matches Supabase's
  // default resend interval.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setUnconfirmedEmail(null);
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
    const captcha = captchaToken ? { captchaToken } : {};
    const { data, error: authError } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password, options: captcha })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next), ...captcha } });
    // The token is spent whether or not the call succeeded.
    setCaptchaResetKey((key) => key + 1);

    if (authError) {
      setError(authError.message);
      setPending(false);
      // Supabase returns this exact message (no separate error code) when
      // signInWithPassword() hits a real, correctly-passworded account that
      // just hasn't confirmed its email yet -- surface the resend option
      // here too, not only right after sign-up, since this is the more
      // likely place someone lands if their original confirmation link
      // already expired before they got a chance to use it.
      if (mode === 'sign-in' && authError.message === 'Email not confirmed') {
        setUnconfirmedEmail(email);
      }
      return;
    }

    if (mode === 'sign-up' && !data.session) {
      // Account created, but this project requires email confirmation and
      // no session was issued yet -- stop here instead of navigating to a
      // route that will just redirect back once proxy.ts sees no user.
      setPending(false);
      setInfo('Check your email to confirm your account, then sign in.');
      setUnconfirmedEmail(email);
      return;
    }

    // router.refresh() re-runs Server Component data fetching (including
    // lib/auth/org-context.ts) against the now-live session cookie before
    // router.push() navigates, so /applications doesn't render a stale
    // signed-out state for one frame.
    router.refresh();
    router.push(next ?? '/applications');
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setInfo(null);
    setPending(true);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider,
      // Microsoft (Entra ID) only returns the email address when asked.
      options: { redirectTo: callbackUrl(next), ...(provider === 'azure' ? { scopes: 'email' } : {}) },
    });
    // On success the browser is already leaving for the provider.
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  async function handleResend() {
    if (!unconfirmedEmail) return;
    setError(null);
    setInfo(null);
    setResendPending(true);

    const supabase = createClient();
    // type: 'signup' re-sends the same confirmation email signUp() itself
    // triggers -- this doesn't create a second account or error if one
    // already exists, it just issues a fresh, unexpired link for the
    // pending one. See lib/seo.ts's SITE_URL comment / the DELIVERY_REPORT
    // known-gap note: if the Supabase project's dashboard "Site URL" is
    // still pointed at localhost, the new link will have the same problem
    // as the old one -- that's a dashboard config fix, not something this
    // call can work around client-side.
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: unconfirmedEmail,
      options: captchaToken ? { captchaToken } : {},
    });
    setCaptchaResetKey((key) => key + 1);

    setResendPending(false);

    if (resendError) {
      setError(resendError.message);
      return;
    }

    setInfo(`Confirmation email resent to ${unconfirmedEmail}.`);
    setResendCooldown(60);
  }

  // iPhone app only: Apple's native sheet, then a Supabase session from its
  // identity token. Apple shares the person's name only the first time.
  async function handleApple() {
    const apple = nativeApp()?.Plugins?.AppleSignIn;
    if (!apple) return;
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      const result = await apple.signIn();
      if (result.cancelled || !result.identityToken || !result.nonce) {
        setPending(false);
        return;
      }
      const supabase = createClient();
      const { error: appleError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: result.identityToken,
        nonce: result.nonce,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      setCaptchaResetKey((key) => key + 1);
      if (appleError) {
        setError(appleError.message);
        setPending(false);
        return;
      }
      const fullName = [result.givenName, result.familyName].filter(Boolean).join(' ');
      if (fullName) await supabase.auth.updateUser({ data: { full_name: fullName } });
      router.refresh();
      router.push(next ?? '/applications');
    } catch (appleFailure) {
      setError(appleFailure instanceof Error ? appleFailure.message : 'Sign in with Apple did not work. Try again.');
      setPending(false);
    }
  }

  async function handleForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    // The email's link goes to /auth/confirm (Supabase's recovery template),
    // which works in any browser -- not only the one that asked for it.
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      ...(captchaToken ? { captchaToken } : {}),
    });
    setCaptchaResetKey((key) => key + 1);
    setPending(false);
    if (resetError && (resetError.status === 429 || /captcha/i.test(resetError.message))) {
      setError(
        resetError.status === 429
          ? 'Too many reset requests. Wait a few minutes and try again.'
          : 'The security check failed. Wait for it to finish, then try again.'
      );
      return;
    }
    // Same message whether or not the address has an account, so this form
    // can't be used to find out who has one.
    setInfo(`If ${email.trim()} has a PermitField account, we've emailed it a link to choose a new password. The link works for 1 hour.`);
  }

  function showForgot(value: boolean) {
    setForgot(value);
    setError(null);
    setInfo(null);
    setUnconfirmedEmail(null);
  }

  if (forgot) {
    return (
      <div>
        <h2 className="text-base font-semibold text-white">Reset your password</h2>
        <p className="mt-1 text-sm text-slate-400">Enter your account email and we&apos;ll send you a link to choose a new password.</p>
        <form onSubmit={handleForgot} className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="reset-email" className="mb-1 block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <Turnstile onToken={setCaptchaToken} resetKey={captchaResetKey} />

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {info && (
            <p role="status" className="text-sm text-emerald-400">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || captchaMissing}
            className="mt-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Please wait…' : 'Send reset link'}
          </button>
        </form>
        <button type="button" onClick={() => showForgot(false)} className="mt-4 text-sm text-slate-400 underline underline-offset-2 hover:text-white">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex rounded-full border border-white/10 bg-white/5 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode('sign-in')}
          className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
            mode === 'sign-in' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('sign-up')}
          className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
            mode === 'sign-up' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-300">
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
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            // New passwords need 10+ characters (Supabase Auth enforces the
            // same); existing shorter passwords can still sign in.
            minLength={mode === 'sign-up' ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => showForgot(true)}
              className="mt-1 text-sm text-slate-400 underline underline-offset-2 hover:text-white"
            >
              Forgot password?
            </button>
          )}
        </div>

        <Turnstile onToken={setCaptchaToken} resetKey={captchaResetKey} />

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {info && (
          <p role="status" className="text-sm text-emerald-400">
            {info}
          </p>
        )}

        {unconfirmedEmail && (
          <button
            type="button"
            onClick={handleResend}
            disabled={resendPending || resendCooldown > 0 || captchaMissing}
            className="text-left text-sm font-medium text-slate-300 underline decoration-dotted underline-offset-2 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 disabled:no-underline"
          >
            {resendPending
              ? 'Resending…'
              : resendCooldown > 0
                ? `Resend confirmation email (${resendCooldown}s)`
                : 'Resend confirmation email'}
          </button>
        )}

        <button
          type="submit"
          disabled={pending || captchaMissing}
          className="mt-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {showApple && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-center text-xs text-slate-500">or</p>
          <button
            type="button"
            onClick={() => void handleApple()}
            disabled={pending || captchaMissing}
            className="rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Apple
          </button>
        </div>
      )}

      {visibleProviders.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-center text-xs text-slate-500">or</p>
          {visibleProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => void handleOAuth(provider)}
              disabled={pending}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue with {OAUTH_PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
