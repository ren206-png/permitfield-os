import Link from 'next/link';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';

// COPY_DECK.md §6-7. Reuses LEGAL_DISCLAIMER verbatim from lib/brand.ts
// rather than writing new legal copy for this phase, keeping this disclaimer
// consistent with wherever else the product already shows it.
export function FooterCta() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      {/* Solid banner is already vivid enough to work unchanged in both themes. */}
      <div className="relative overflow-hidden bg-orange-600 px-6 py-16 text-center">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-white">
            Ready to organize your next permit application?
          </h2>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-md bg-white px-5 py-2.5 text-sm font-medium text-orange-700 shadow-md transition hover:bg-orange-50"
          >
            Create your account
          </Link>
          <p className="mx-auto mt-8 max-w-2xl text-xs text-orange-100">
            {LEGAL_DISCLAIMER}
          </p>
        </div>
      </div>
      <div className="border-t border-zinc-200 bg-white px-6 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500">
        <Link href="/login" className="hover:text-zinc-600 dark:hover:text-zinc-300">
          Sign in
        </Link>
        <span className="mx-2">·</span>
        <span>
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </span>
      </div>
    </footer>
  );
}
