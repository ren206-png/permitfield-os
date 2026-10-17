import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';
import { safeNextPath } from '@/lib/auth/next-path';
import { fetchAppleSignInEnabled, fetchEnabledOAuthProviders } from '@/lib/auth/oauth-providers';
import { LoginForm } from './login-form';

// Server Component shell only -- the actual sign-in/sign-up interaction runs
// client-side (login-form.tsx) against lib/supabase/client.ts, since Supabase
// password auth's whole point is that the browser talks to Supabase Auth
// directly rather than proxying credentials through our own Route Handler
// (this app never touches a password's plaintext server-side, consistent
// with the "never enter credentials into a field you don't own" instinct
// this whole product is built to encourage in contractors dealing with
// permit portals).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; mode?: string; deleted?: string }> }) {
  const { next: requestedNext, error: callbackError, mode, deleted } = await searchParams;
  // Where to go after signing in -- a team invitation link or a page inside
  // the app (safeNextPath).
  const next = safeNextPath(requestedNext);
  const [providers, appleEnabled] = await Promise.all([fetchEnabledOAuthProviders(), fetchAppleSignInEnabled()]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(next ?? '/applications');
  }

  const notice = 'mb-4 rounded-lg border px-3 py-2 text-sm';
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-14 overflow-hidden bg-[#060a1e] px-4 py-14 lg:flex-row lg:gap-20 lg:px-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(234,88,12,0.3),transparent_60%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-1/2 h-[26rem] w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-amber-600/20 blur-3xl" />
      <aside className="relative hidden max-w-md lg:block">
        <p className="text-sm font-medium text-orange-300">Built for Canadian trade contractors</p>
        <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-white">
          Permit applications,{' '}
          <span className="bg-gradient-to-r from-orange-300 via-amber-300 to-yellow-200 bg-clip-text text-transparent">
            organized from intake to filing.
          </span>
        </h2>
        <ul className="mt-8 space-y-4 text-sm text-slate-300">
          {[
            'Every application’s documents, status and history in one record.',
            'AI-assisted extraction of key fields, for your review.',
            'Your data is scoped to your organization, enforced in the database.',
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-xs text-orange-300">✓</span>
              {line}
            </li>
          ))}
        </ul>
      </aside>
      <div className="relative w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight text-white">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-600 to-amber-600 text-base font-bold shadow-lg shadow-orange-950/50">
            P
          </span>
          <h1>{PRODUCT_NAME}</h1>
        </Link>
        <p className="mt-3 text-center text-sm text-slate-400">
          Permitting and local compliance copilot for Canadian trade contractors.
        </p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#0a0f2c]/90 p-7 shadow-2xl shadow-orange-950/60 backdrop-blur">
          {deleted === '1' && (
            <p role="status" className={`${notice} border-emerald-400/30 bg-emerald-500/10 text-emerald-300`}>
              Your account has been deleted. Thanks for trying PermitField.
            </p>
          )}
          {callbackError === 'reset_link' && (
            <p role="alert" className={`${notice} border-red-400/30 bg-red-500/10 text-red-300`}>
              That password-reset link didn&apos;t work -- it may have expired or already been used. Use &quot;Forgot password?&quot; to get a new one.
            </p>
          )}
          {callbackError === 'callback' && (
            <p role="alert" className={`${notice} border-red-400/30 bg-red-500/10 text-red-300`}>
              That sign-in link didn&apos;t work -- it may have expired or already been used. Sign in below.
            </p>
          )}
          <LoginForm
            next={next}
            providers={providers}
            appleEnabled={appleEnabled}
            initialMode={mode === 'sign-up' ? 'sign-up' : 'sign-in'}
          />
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">{LEGAL_DISCLAIMER}</p>
        <p className="mt-2 text-center text-xs text-slate-500">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-300">Privacy</Link> ·{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-slate-300">Terms</Link>
        </p>
      </div>
    </div>
  );
}
