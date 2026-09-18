'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarLink {
  href: string;
  label: string;
  /** Unread count badge (failure-notification system only) -- omitted or 0
   * renders no badge at all. */
  badge?: number;
}

interface AppSidebarProps {
  /** isBillingEnabled() -- visible to every org member; the owner-only gate
   * lives in app/(app)/settings/billing/actions.ts, not here. */
  showBillingLink: boolean;
  /** isAdminPanelEnabled() && isCurrentUserAdmin() -- unlike the one above,
   * this IS an access check, not just a flag, since there's no
   * "locked admin" page for a non-admin to land on. */
  showAdminLink: boolean;
  /** isDashboardEnabled() -- same flag-only shape as showBillingLink; the
   * 'analytics' entitlement gate lives in app/(app)/dashboard/page.tsx
   * itself (renders LockedFeature rather than 404ing), not here. */
  showDashboardLink: boolean;
  /** isFailureNotificationsEnabled() -- same flag-only shape as the others
   * above. Flag checked in the layout, not here, matching this component's
   * own "gating booleans computed upstream" pattern. */
  showNotificationsLink: boolean;
  /** Count of unread rows in the notifications table for this org, computed
   * in the layout (see that file's own header comment) -- 0 when the flag
   * above is off, since the layout never queries in that case. */
  unreadNotificationCount: number;
  /** isQuotesPaymentsEnabled() -- Gate 4 (Quotes & Payments), Phase A. Same
   * flag-only shape as the others above, not an access check: visible to
   * every org member the moment the flag is on, with the entitlement-gated
   * "locked" state rendered inside the pages themselves (see e.g.
   * app/(app)/estimates/page.tsx), not by hiding these links. */
  showQuotesPaymentsLinks: boolean;
}

// Left-hand feature navigation for the authenticated app shell. Replaces the
// horizontal <nav> that used to live inline inside app/(app)/layout.tsx's
// <header> -- same links, same gating booleans (still computed in the
// layout, a server component, and passed down as plain props; nothing here
// re-derives orgId or re-checks a flag) -- just laid out as a sidebar, with
// active-route highlighting added via usePathname(), which is why this one
// piece has to be a client component while the rest of the layout stays a
// server component.
//
// Renders as a horizontal, scrollable strip below the header on narrow
// screens (md:flex-col below turns it into a vertical column) rather than
// disappearing on mobile -- the old top nav had no mobile-specific handling
// either, but a sidebar that vanishes below `md` with no fallback would be a
// regression, not a lateral move.
export function AppSidebar({
  showBillingLink,
  showAdminLink,
  showDashboardLink,
  showNotificationsLink,
  unreadNotificationCount,
  showQuotesPaymentsLinks,
}: AppSidebarProps) {
  const pathname = usePathname();

  const links: SidebarLink[] = [
    { href: '/applications', label: 'Applications' },
    // No flag gates this one, unlike the others below -- /clients is plain
    // RLS-scoped, member-visible functionality (clients_select's policy is
    // is_org_member(org_id), same as every other org-wide resource), not a
    // gated feature.
    { href: '/clients', label: 'Clients' },
    ...(showDashboardLink ? [{ href: '/dashboard', label: 'Dashboard' }] : []),
    ...(showQuotesPaymentsLinks
      ? [
          { href: '/estimates', label: 'Estimates' },
          { href: '/invoices', label: 'Invoices' },
          { href: '/settings/tax-profile', label: 'Tax profile' },
        ]
      : []),
    ...(showNotificationsLink
      ? [{ href: '/notifications', label: 'Notifications', badge: unreadNotificationCount }]
      : []),
    ...(showBillingLink ? [{ href: '/settings/billing', label: 'Billing' }] : []),
    ...(showAdminLink ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  // Exact match, or a sub-route of it (e.g. /invoices/[id] still highlights
  // "Invoices") -- but never a prefix collision, since every href here is
  // itself a distinct leaf path (no href is a prefix of another href in this
  // list).
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="w-full shrink-0 md:w-48">
      <nav className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0" aria-label="Features">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {link.label}
              {!!link.badge && (
                <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {link.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
