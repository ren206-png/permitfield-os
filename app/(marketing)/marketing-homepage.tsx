import Link from 'next/link';
import { Instrument_Serif } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { PRODUCT_NAME } from '@/lib/brand';
import { Hero } from './sections/hero';
import { CityStrip } from './sections/city-strip';
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
// Visual design: a light, editorial page -- warm paper background, ink
// text, a serif display face (Instrument Serif, loaded here so only this
// route downloads it) and one clay accent, with the real product
// screenshots framed like documents. Colour tokens (paper, ink, line, clay)
// and font-display live in app/globals.css.
//
// Vercel Web Analytics is mounted here (not app/layout.tsx) so it only loads
// on this flag-gated route, not across the authenticated app.
const displaySerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
});

const NAV = [
  ['#how-it-works', 'How it works'],
  ['#features', 'Features'],
  ['#coverage', 'Coverage'],
] as const;

export function MarketingHomepage({ signedIn }: { signedIn: boolean }) {
  return (
    <div id="marketing-root" className={`${displaySerif.variable} flex min-h-full flex-col bg-paper text-ink`}>
      <StructuredData />
      <Analytics />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold tracking-tight">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink font-display text-lg leading-none text-paper">
              P
            </span>
            {PRODUCT_NAME}
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-ink/70 md:flex">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="transition hover:text-ink">
                {label}
              </a>
            ))}
            {!signedIn && (
              <Link href="/login" className="transition hover:text-ink">
                Sign in
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href={signedIn ? '/applications' : '/login?mode=sign-up'}
              className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85 sm:px-5"
            >
              {signedIn ? 'Open the app' : 'Get started'}
            </Link>
            {/* No-JS mobile menu. */}
            <details className="group relative md:hidden">
              <summary
                aria-label="Menu"
                className="flex h-10 w-10 cursor-pointer list-none flex-col items-center justify-center gap-1.5 [&::-webkit-details-marker]:hidden"
              >
                <span className="h-px w-5 bg-ink" />
                <span className="h-px w-5 bg-ink" />
                <span className="h-px w-5 bg-ink" />
              </summary>
              <div className="absolute right-0 top-12 w-52 rounded-xl border border-line bg-white p-2 text-sm shadow-lg shadow-ink/5">
                {NAV.map(([href, label]) => (
                  <a key={href} href={href} className="block rounded-lg px-3 py-2 hover:bg-paper">
                    {label}
                  </a>
                ))}
                {!signedIn && (
                  <Link href="/login" className="block rounded-lg px-3 py-2 hover:bg-paper">
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
        <CityStrip />
        <HowItWorks />
        <Capabilities />
        <Coverage />
      </main>

      <FooterCta signedIn={signedIn} />
    </div>
  );
}
