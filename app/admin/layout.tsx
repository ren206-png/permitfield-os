import type { ReactNode } from 'react';
import Link from 'next/link';
import { PRODUCT_SHORT } from '@/lib/brand';
import { signOutAction } from '@/app/actions/auth';

// Standalone chrome for /admin -- deliberately not nested under
// app/(app)/layout.tsx. That layout calls requireOrgContext(), which
// redirects to /onboarding for a user with no org membership; an admin
// operating this panel may not (and doesn't need to) belong to any org at
// all, so admin routes get their own layout with their own gate
// (requireAdmin(), called by app/admin/page.tsx itself, not here -- same
// "each route re-derives its own authorization" discipline as
// app/(app)/layout.tsx's header comment describes for requireOrgContext()).
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-white">{PRODUCT_SHORT} · Platform Admin</span>
            <Link href="/admin" className="text-sm text-zinc-300 hover:text-white">
              Organizations
            </Link>
            <Link href="/admin/client-portal" className="text-sm text-zinc-300 hover:text-white">
              Client portal tokens
            </Link>
            <Link href="/applications" className="text-sm text-zinc-300 hover:text-white">
              Back to app
            </Link>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-zinc-300 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
