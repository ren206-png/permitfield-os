import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isCurrentUserAdmin } from '@/lib/auth/admin';
import { isAdminPanelEnabled, isBillingEnabled, isFailureNotificationsEnabled } from '@/lib/flags';
import { PRODUCT_SHORT, LEGAL_DISCLAIMER } from '@/lib/brand';
import { signOutAction } from '@/app/actions/auth';
import { createClient } from '@/lib/supabase/server';

// Shared chrome for every authenticated, org-scoped page. requireOrgContext()
// is the single gate every (app) route passes through: no session -> /login,
// session but no org -> /onboarding. Individual pages call it again
// themselves (cheap, RLS-scoped, and consistent with this codebase's
// "re-derive from the DB, don't thread trust through props" habit -- see
// generate-pdf.ts's coverage_level re-check) rather than receiving orgId via
// a prop or context provider that could go stale across a client-side
// navigation.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { orgId, orgName } = await requireOrgContext();
  // Cheap enough to check on every (app) page load (one env var read plus a
  // getUser() call that's already been made by requireOrgContext() above --
  // requireUser() inside isCurrentUserAdmin() re-hits auth.getUser(), same
  // "re-derive, don't thread trust through props" pattern this file's own
  // header comment describes for orgId). The flag check happens first so a
  // non-admin environment never even evaluates the allowlist.
  const showAdminLink = isAdminPanelEnabled() && (await isCurrentUserAdmin());
  // No owner-only check here, unlike showAdminLink above -- the billing page
  // itself is visible to every org member (org_subscriptions_select's own
  // RLS policy is member-wide, not owner-only; see that migration's header
  // comment), it just renders read-only for a non-owner. The owner gate
  // lives in app/(app)/settings/billing/actions.ts instead.
  const showBillingLink = isBillingEnabled();

  // Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS, see
  // lib/flags.ts's isFailureNotificationsEnabled() header comment). Flag
  // checked first, same as showAdminLink above -- an environment with the
  // flag off never queries the notifications table at all, byte-identical
  // to before this build. A fresh createClient() call rather than threading
  // one down from requireOrgContext(), matching this file's own header
  // comment's "re-derive from the DB, don't thread trust through props"
  // habit; a `head: true` count avoids fetching any row body just to get a
  // number, and needs no pagination guard the way a real .select() would
  // (PostgREST's 1000-row cap only bounds returned rows, not a count).
  let unreadNotificationCount = 0;
  if (isFailureNotificationsEnabled()) {
    const supabase = await createClient();
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('read_at', null);
    unreadNotificationCount = count ?? 0;
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex shrink-0 items-center gap-6">
            <Link href="/applications" className="text-sm font-semibold tracking-tight text-zinc-900">
              {PRODUCT_SHORT}
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/applications" className="hover:text-zinc-900">
                Applications
              </Link>
              {isFailureNotificationsEnabled() && (
                <Link href="/notifications" className="hover:text-zinc-900">
                  Notifications
                  {unreadNotificationCount > 0 && (
                    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {unreadNotificationCount}
                    </span>
                  )}
                </Link>
              )}
              {showBillingLink && (
                <Link href="/settings/billing" className="hover:text-zinc-900">
                  Billing
                </Link>
              )}
              {showAdminLink && (
                <Link href="/admin" className="hover:text-zinc-900">
                  Admin
                </Link>
              )}
            </nav>
          </div>
          {/* min-w-0 lets this group (and the truncated span inside it) shrink
              below its content width instead of forcing the org name onto a
              second line and crowding the nav above -- the bug this fixes at
              375px, where org names like "Org A - Test Mechanical Ltd." don't
              fit alongside "Applications" and "Sign out" on one line. */}
          <div className="flex min-w-0 items-center gap-4">
            <span className="min-w-0 truncate text-sm text-zinc-500" title={orgName}>
              {orgName}
            </span>
            <form action={signOutAction} className="shrink-0">
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
