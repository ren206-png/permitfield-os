import Link from 'next/link';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';

// COPY_DECK.md §6-7. Reuses LEGAL_DISCLAIMER verbatim from lib/brand.ts
// rather than writing new legal copy for this phase, keeping this disclaimer
// consistent with wherever else the product already shows it.
export function FooterCta({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 lg:py-28">
        <h2 className="max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Ready to organize your next <em className="text-[#e8a382]">permit application?</em>
        </h2>
        <Link
          href={signedIn ? '/applications' : '/login?mode=sign-up'}
          className="group mt-10 inline-flex items-center gap-2 rounded-full bg-paper px-7 py-3.5 text-sm font-medium text-ink transition hover:bg-white"
        >
          {signedIn ? 'Open the app' : 'Create your account'}
          <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span>
        </Link>
        <p className="mt-16 max-w-2xl border-t border-paper/10 pt-8 text-xs leading-relaxed text-paper/65">{LEGAL_DISCLAIMER}</p>
      </div>
      <div className="border-t border-paper/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-xs text-paper/65 sm:px-6">
          <span className="font-display text-base text-paper/80">{PRODUCT_NAME}</span>
          <Link href={signedIn ? '/applications' : '/login'} className="transition hover:text-paper">
            {signedIn ? 'Open the app' : 'Sign in'}
          </Link>
          <Link href="/privacy" className="transition hover:text-paper">Privacy</Link>
          <Link href="/terms" className="transition hover:text-paper">Terms</Link>
          <span className="sm:ml-auto">© {new Date().getFullYear()} {PRODUCT_NAME}</span>
        </div>
      </div>
    </footer>
  );
}
