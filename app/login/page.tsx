import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';
import { safeNextPath } from '@/lib/auth/next-path';
import { fetchAppleSignInEnabled, fetchEnabledOAuthProviders } from '@/lib/auth/oauth-providers';
import { Instrument_Serif } from 'next/font/google';
import { LoginForm } from './login-form';

// Same light editorial look as the marketing homepage (paper, ink, one clay
// accent and the Instrument Serif display face; tokens in app/globals.css),
// so "Get started" doesn't jump to a different-looking page.
const displaySerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
});

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
    <div className={`${displaySerif.variable} flex flex-1 flex-col items-center justify-center gap-14 bg-paper px-4 py-14 text-ink lg:flex-row lg:gap-20 lg:px-12`}>
      <aside className="hidden max-w-md lg:block">
        <p className="text-sm font-medium text-clay">Built for Canadian trade contractors</p>
        <h2 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight">
          Permit applications, <em className="text-clay">organized from intake to filing.</em>
        </h2>
        <ul className="mt-8 space-y-4 text-sm text-ink/75">
          {[
            'Every application’s documents, status and history in one record.',
            'AI-assisted extraction of key fields, for your review.',
            'Your data is scoped to your organization, enforced in the database.',
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-clay/40 text-xs text-clay">✓</span>
              {line}
            </li>
          ))}
        </ul>
      </aside>
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2.5 text-xl font-semibold tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink font-display text-2xl leading-none text-paper">
            P
          </span>
          <h1>{PRODUCT_NAME}</h1>
        </Link>
        <p className="mt-3 text-center text-sm text-ink/65">
          Permitting and local compliance copilot for Canadian trade contractors.
        </p>
        <div className="mt-8 rounded-2xl border border-line bg-white p-7 shadow-sm shadow-ink/5">
          {deleted === '1' && (
            <p role="status" className={`${notice} border-emerald-200 bg-emerald-50 text-emerald-800`}>
              Your account has been deleted. Thanks for trying PermitField.
            </p>
          )}
          {callbackError === 'reset_link' && (
            <p role="alert" className={`${notice} border-red-200 bg-red-50 text-red-800`}>
              That password-reset link didn&apos;t work -- it may have expired or already been used. Use &quot;Forgot password?&quot; to get a new one.
            </p>
          )}
          {callbackError === 'callback' && (
            <p role="alert" className={`${notice} border-red-200 bg-red-50 text-red-800`}>
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
        <p className="mt-6 text-center text-xs text-ink/65">{LEGAL_DISCLAIMER}</p>
        <p className="mt-2 text-center text-xs text-ink/65">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">Privacy</Link> ·{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink">Terms</Link>
        </p>
      </div>
    </div>
  );
}
