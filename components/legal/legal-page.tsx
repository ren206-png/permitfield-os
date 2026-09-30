import Link from 'next/link';
import { LEGAL_LAST_UPDATED, PRODUCT_NAME } from '@/lib/brand';

// Shared shell for the public /privacy and /terms pages.
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {PRODUCT_NAME}
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated {LEGAL_LAST_UPDATED}</p>
      <div className="mt-8 space-y-6 text-sm leading-6 text-zinc-700 dark:text-zinc-300 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
        {children}
      </div>
      <p className="mt-12 text-sm text-zinc-500">
        <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of service</Link>
      </p>
    </div>
  );
}
