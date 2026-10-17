import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { PRODUCT_NAME } from '@/lib/brand';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { Capabilities } from './sections/capabilities';
import { Coverage } from './sections/coverage';
import { FooterCta } from './sections/footer-cta';
import { StructuredData } from './structured-data';

// Marketing Homepage v2 (COPY_DECK.md). Rendered for every visitor to '/'
// when NEXT_PUBLIC_MARKETING_V2 is on -- see app/page.tsx and proxy.ts. A
// signed-in visitor (`signedIn`) gets "Open the app" in place of the sign-in
// and sign-up links. Every section below sources its copy from COPY_DECK.md and
// its capability claims from MARKETING_CAPABILITY_LEDGER.md; nothing here
// should be edited without updating both documents.
//
// Visual redesign: a dark navy page with indigo-violet glow, pill buttons and
// a framed product illustration. The page is dark only, so #marketing-root
// always carries the `dark` class (globals.css keys `dark:` off it) and the
// old light/dark toggle is gone.
//
// Vercel Web Analytics is mounted here (not app/layout.tsx) so it only loads
// on this flag-gated route, not across the authenticated app.
export function MarketingHomepage({ signedIn }: { signedIn: boolean }) {
  const pill =
    'whitespace-nowrap rounded-full border border-white/20 px-4 py-2 text-sm sm:px-5 font-medium text-white transition hover:border-indigo-400/70 hover:bg-white/5';
  return (
    <div id="marketing-root" className="dark flex min-h-full flex-col bg-[#060a1e] text-slate-300">
      <StructuredData />
      <Analytics />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#060a1e]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <span className="flex items-center gap-2.5 whitespace-nowrap text-lg font-semibold tracking-tight text-white">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-900/50">
              P
            </span>
            {PRODUCT_NAME}
          </span>
          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#how-it-works" className="hover:text-white">How it works</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#coverage" className="hover:text-white">Coverage</a>
            {!signedIn && <Link href="/login" className="hover:text-white">Sign in</Link>}
          </nav>
          <div className="flex items-center gap-3">
            <Link href={signedIn ? '/applications' : '/login?mode=sign-up'} className={pill}>
              {signedIn ? 'Open the app' : 'Get started'}
            </Link>
            {/* No-JS mobile menu. */}
            <details className="group relative md:hidden">
              <summary
                aria-label="Menu"
                className="flex h-10 w-10 cursor-pointer list-none flex-col items-center justify-center gap-1.5 [&::-webkit-details-marker]:hidden"
              >
                <span className="h-0.5 w-6 bg-white" />
                <span className="h-0.5 w-6 bg-white" />
                <span className="h-0.5 w-6 bg-white" />
              </summary>
              <div className="absolute right-0 top-12 w-52 rounded-xl border border-white/10 bg-[#0b1030] p-2 text-sm shadow-xl">
                {[
                  ['#how-it-works', 'How it works'],
                  ['#features', 'Features'],
                  ['#coverage', 'Coverage'],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="block rounded-lg px-3 py-2 hover:bg-white/5">
                    {label}
                  </a>
                ))}
                {!signedIn && (
                  <Link href="/login" className="block rounded-lg px-3 py-2 hover:bg-white/5">
                    Sign in
                  </Link>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Hero signedIn={signedIn} />
        <HowItWorks />
        <Capabilities />
        <Coverage />
      </main>

      <FooterCta signedIn={signedIn} />
    </div>
  );
}
