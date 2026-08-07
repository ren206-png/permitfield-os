import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { PRODUCT_SHORT, LEGAL_DISCLAIMER } from '@/lib/brand';
import { signOutAction } from '@/app/actions/auth';

// Shared chrome for every authenticated, org-scoped page. requireOrgContext()
// is the single gate every (app) route passes through: no session -> /login,
// session but no org -> /onboarding. Individual pages call it again
// themselves (cheap, RLS-scoped, and consistent with this codebase's
// "re-derive from the DB, don't thread trust through props" habit -- see
// generate-pdf.ts's coverage_level re-check) rather than receiving orgId via
// a prop or context provider that could go stale across a client-side
// navigation.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { orgName } = await requireOrgContext();

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/applications" className="text-sm font-semibold tracking-tight text-zinc-900">
              {PRODUCT_SHORT}
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/applications" className="hover:text-zinc-900">
                Applications
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">{orgName}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-sm text-zinc-600 hover:text-zinc-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-zinc-200 bg-white py-4">
        <p className="mx-auto max-w-5xl px-4 text-center text-xs text-zinc-500 sm:px-6">{LEGAL_DISCLAIMER}</p>
      </footer>
    </div>
  );
}
