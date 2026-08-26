import Link from 'next/link';
import { PRODUCT_NAME } from '@/lib/brand';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { Capabilities } from './sections/capabilities';
import { Coverage } from './sections/coverage';
import { FooterCta } from './sections/footer-cta';

// Marketing Homepage v2 (COPY_DECK.md). Rendered only for unauthenticated
// visitors to '/' when NEXT_PUBLIC_MARKETING_V2 is on -- see app/page.tsx
// and proxy.ts. Every section below sources its copy from COPY_DECK.md and
// its capability claims from MARKETING_CAPABILITY_LEDGER.md; nothing here
// should be edited without updating both documents.
export function MarketingHomepage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-zinc-900">
            {PRODUCT_NAME}
          </span>
          <nav className="flex items-center gap-6 text-sm text-zinc-600">
            <a href="#how-it-works" className="hover:text-zinc-900">
              How it works
            </a>
            <a href="#coverage" className="hover:text-zinc-900">
              What&apos;s covered
            </a>
            <Link href="/login" className="hover:text-zinc-900">
              Sign in
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800"
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
