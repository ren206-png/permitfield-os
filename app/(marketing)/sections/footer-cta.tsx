import Link from 'next/link';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';

// COPY_DECK.md §6-7. Reuses LEGAL_DISCLAIMER verbatim from lib/brand.ts
// rather than writing new legal copy for this phase, keeping this disclaimer
// consistent with wherever else the product already shows it.
export function FooterCta() {
  return (
    <footer className="border-t border-zinc-200">
      <div className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold text-zinc-900">
          Ready to organize your next permit application?
        </h2>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Create your account
        </Link>
        <p className="mx-auto mt-8 max-w-2xl text-xs text-zinc-500">
          {LEGAL_DISCLAIMER}
        </p>
      </div>
      <div className="border-t border-zinc-200 px-6 py-6 text-center text-xs text-zinc-400">
        <Link href="/login" className="hover:text-zinc-600">
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
