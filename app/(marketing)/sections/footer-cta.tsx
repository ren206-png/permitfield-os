import Link from 'next/link';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';

// COPY_DECK.md §6-7. Reuses LEGAL_DISCLAIMER verbatim from lib/brand.ts
// rather than writing new legal copy for this phase, keeping this disclaimer
// consistent with wherever else the product already shows it.
export function FooterCta({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t border-white/5">
      <div className="relative overflow-hidden px-6 py-20 text-center">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(234,88,12,0.3),transparent_65%)]" />
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Ready to organize your next permit application?
          </h2>
          <Link
            href={signedIn ? '/applications' : '/login?mode=sign-up'}
            className="mt-8 inline-block rounded-full bg-gradient-to-r from-orange-600 to-amber-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-950/50 transition hover:brightness-110"
          >
            {signedIn ? 'Open the app' : 'Create your account'}
          </Link>
          <p className="mx-auto mt-10 max-w-2xl text-xs text-slate-400">{LEGAL_DISCLAIMER}</p>
        </div>
      </div>
      <div className="border-t border-white/5 px-6 py-6 text-center text-xs text-slate-500">
        <Link href={signedIn ? '/applications' : '/login'} className="hover:text-slate-300">
          {signedIn ? 'Open the app' : 'Sign in'}
        </Link>
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-slate-300">Privacy</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-slate-300">Terms</Link>
        <span className="mx-2">·</span>
        <span>© {new Date().getFullYear()} {PRODUCT_NAME}</span>
      </div>
    </footer>
  );
}
