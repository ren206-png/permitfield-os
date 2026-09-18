import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isCurrentUserAdmin } from '@/lib/auth/admin';
import { isAdminPanelEnabled, isBillingEnabled, isQuotesPaymentsEnabled, isDashboardEnabled } from '@/lib/flags';
import { PRODUCT_SHORT, LEGAL_DISCLAIMER } from '@/lib/brand';
import { signOutAction } from '@/app/actions/auth';
import { AppSidebar } from '@/components/app-sidebar';

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
  // Gate 4 (Quotes & Payments), Phase A. No entitlement check here on
  // purpose, matching showBillingLink's own reasoning above -- the nav link
  // is visible to every org member the moment the flag is on, same as
  // billing's own link; the entitlement-gated "locked" state renders inside
  // the pages themselves (see e.g. app/(app)/estimates/page.tsx), not by
  // hiding the nav entry, so a member without the entitlement still learns
  // the feature exists rather than it silently vanishing.
  const showQuotesPaymentsLinks = isQuotesPaymentsEnabled();
  // Same flag-only shape as showBillingLink above, not an access check --
  // app/(app)/dashboard/page.tsx does its own can(orgId, 'analytics') check
  // and renders LockedFeature for an org whose plan lacks it, exactly the
  // "flag says the route exists, the page itself decides visibility"
  // division of labor that page's own header comment documents.
  const showDashboardLink = isDashboardEnabled();

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/applications" className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900">
            {PRODUCT_SHORT}
          </Link>
          {/* min-w-0 lets this group (and the truncated span inside it) shrink
              below its content width instead of forcing the org name onto a
              second line -- the bug this fixes at 375px, where org names
              like "Org A - Test Mechanical Ltd." don't fit alongside
              "Sign out" on one line. Feature links used to live in this
              header's own <nav> too; they now live in the AppSidebar below
              instead, which is why this row is just branding + org + sign
              out. */}
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

      {/* flex-col on mobile (sidebar renders as a horizontal scrollable strip
          above the page content) becomes flex-row at md and up (sidebar
          becomes a fixed-width left column) -- see AppSidebar's own header
          comment for why it can't just disappear below md instead. */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:gap-8">
        <AppSidebar
          showBillingLink={showBillingLink}
          showAdminLink={showAdminLink}
          showDashboardLink={showDashboardLink}
          showQuotesPaymentsLinks={showQuotesPaymentsLinks}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <footer className="border-t border-zinc-200 bg-white py-4">
        <p className="mx-auto max-w-6xl px-4 text-center text-xs text-zinc-500 sm:px-6">{LEGAL_DISCLAIMER}</p>
      </footer>
    </div>
  );
}
