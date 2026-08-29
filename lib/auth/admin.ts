import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/org-context';
import { isAdminPanelEnabled } from '@/lib/flags';

// Identity-based allowlist for the platform admin panel (app/admin/) --
// deliberately separate from the per-org `role: 'owner' | 'member'` in
// org_members (lib/auth/org-context.ts). Org role answers "can this person
// manage *their own* org"; this answers "can this person see *every* org,
// every user, every application on the whole platform." Conflating the two
// would mean any org's owner (a customer) gets platform-wide visibility,
// which is not the intent.
//
// Server-only env var (no NEXT_PUBLIC_ prefix -- never inlined into the
// client bundle). Comma-separated, trimmed, lower-cased so a stray space or
// casing difference in the env var doesn't silently lock the intended admin
// out. Empty/unset resolves to an empty allowlist (nobody is admin), same
// fail-safe-toward-OFF discipline as every flag in lib/flags.ts.
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await requireUser();
  const email = user.email?.toLowerCase();
  if (!email) {
    return false;
  }
  return adminEmails().includes(email);
}

// Gate for every admin route/action. Uses notFound() rather than redirect()
// on purpose: a non-admin (or an unauthenticated request that already
// bounced through requireUser()'s own /login redirect) should see a plain
// 404, not a 403 or a redirect that confirms /admin exists and is merely
// forbidden to them. Also 404s outright when the feature flag is off,
// independent of who's asking -- see lib/flags.ts's isAdminPanelEnabled()
// header comment for why both gates exist.
export async function requireAdmin() {
  if (!isAdminPanelEnabled()) {
    notFound();
  }
  const user = await requireUser();
  const email = user.email?.toLowerCase();
  if (!email || !adminEmails().includes(email)) {
    notFound();
  }
  return user;
}
