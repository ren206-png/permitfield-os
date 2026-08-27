import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { PRODUCT_NAME } from '@/lib/brand';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { Capabilities } from './sections/capabilities';
import { Coverage } from './sections/coverage';
import { FooterCta } from './sections/footer-cta';
import { StructuredData } from './structured-data';

// Marketing Homepage v2 (COPY_DECK.md). Rendered only for unauthenticated
// visitors to '/' when NEXT_PUBLIC_MARKETING_V2 is on -- see app/page.tsx
// and proxy.ts. Every section below sources its copy from COPY_DECK.md and
// its capability claims from MARKETING_CAPABILITY_LEDGER.md; nothing here
// should be edited without updating both documents.
//
// Phase 3 analytics (MARKETING_PHASE_0_FINDINGS.md SS5's open item #2,
// resolved): Vercel Web Analytics, chosen because the app already deploys
// on Vercel (same section) -- no new account, no API key/site ID in code,
// nothing to fabricate. Mounted here (not app/layout.tsx) so it only loads
// on this flag-gated route, not site-wide across the existing authenticated
// app -- turning this flag on does not turn on telemetry for /applications
// or any other existing page. Collection itself still needs "Web Analytics"
// turned on for this project in the Vercel dashboard (a project setting,
// not a code change) before any data appears -- see this phase's report for
// that action item.
export function MarketingHomepage() {
  return (
    <div className="flex min-h-full flex-col bg-white">
      <StructuredData />
      <Analytics />
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-sky-500 text-sm font-bold text-white shadow-sm shadow-indigo-200">
              P
            </span>
            {PRODUCT_NAME}
          </span>
          <nav className="flex items-center gap-6 text-sm text-zinc-600">
            <a href="#how-it-works" className="hidden hover:text-zinc-900 sm:inline">
              How it works
            </a>
            <a href="#coverage" className="hidden hover:text-zinc-900 sm:inline">
              What&apos;s covered
            </a>
            <Link href="/login" className="hover:text-zinc-900">
              Sign in
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-gradient-to-r from-indigo-600 to-sky-500 px-3 py-1.5 font-medium text-white shadow-sm shadow-indigo-200 transition hover:shadow-md hover:shadow-indigo-300"
            >
              Create your account
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Capabilities />
        <Coverage />
      </main>

      <FooterCta />
    </div>
  );
}
