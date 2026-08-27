import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { PRODUCT_NAME } from '@/lib/brand';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { Capabilities } from './sections/capabilities';
import { Coverage } from './sections/coverage';
import { FooterCta } from './sections/footer-cta';
import { StructuredData } from './structured-data';
import { ThemeToggle } from './theme-toggle';

// Applies the persisted theme (if any) to #marketing-root before first
// paint, so returning dark-mode visitors don't see a flash of the light
// page. Scoped to this one element, not <html> -- see theme-toggle.tsx and
// globals.css for why (keeps this entirely out of the authenticated app).
//
// The storage key below is a literal, not an import of
// MARKETING_THEME_STORAGE_KEY from theme-toggle.tsx: that file is a "use
// client" module, and a server component importing a plain (non-component)
// value export from across that boundary gets `undefined` at render time --
// confirmed by inspecting the rendered HTML, which shipped
// `localStorage.getItem(undefined)`. Keep this string in sync with
// MARKETING_THEME_STORAGE_KEY in theme-toggle.tsx if it ever changes.
const MARKETING_THEME_STORAGE_KEY = 'permitfield-marketing-theme';
const NO_FOUC_SCRIPT = `(function(){try{if(window.localStorage.getItem(${JSON.stringify(
  MARKETING_THEME_STORAGE_KEY,
)})==='dark'){document.getElementById('marketing-root').classList.add('dark');}}catch(e){}})();`;

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
    <div id="marketing-root" className="flex min-h-full flex-col bg-white dark:bg-zinc-950">
      {/* eslint-disable-next-line react/no-danger -- static string literal, no user input */}
      <script dangerouslySetInnerHTML={{ __html: NO_FOUC_SCRIPT }} />
      <StructuredData />
      <Analytics />
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-sky-500 text-sm font-bold text-white shadow-sm shadow-indigo-200 dark:shadow-none">
              P
            </span>
            {PRODUCT_NAME}
          </span>
          <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400 sm:gap-6">
            <a href="#how-it-works" className="hidden hover:text-zinc-900 dark:hover:text-white sm:inline">
              How it works
            </a>
            <a href="#coverage" className="hidden hover:text-zinc-900 dark:hover:text-white sm:inline">
              What&apos;s covered
            </a>
            <Link href="/login" className="hover:text-zinc-900 dark:hover:text-white">
              Sign in
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-gradient-to-r from-indigo-600 to-sky-500 px-3 py-1.5 font-medium text-white shadow-sm shadow-indigo-200 transition hover:shadow-md hover:shadow-indigo-300 dark:shadow-none"
            >
              Create your account
            </Link>
            <ThemeToggle />
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
