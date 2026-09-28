import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/lib/authz';
import { createClient } from '@/lib/supabase/server';

/** Which organization a member of several is working in. Only a hint: it is
 * honoured only when the user really is a member of that org (re-checked on
 * every request below), otherwise the oldest membership is used. */
export const ACTIVE_ORG_COOKIE = 'permitfield_active_org';

// Every (app) route needs "who is signed in, and which org are they acting
// as" before it can run a single RLS-scoped query. This is deliberately not
// cached in a cookie/JWT claim and re-derived from org_members on every call
// -- same "never trust client state for a security-relevant decision"
// discipline the Inngest functions apply to coverage_level (see audit.ts,
// generate-pdf.ts). Cheap (single indexed query) and correct beats cheap and
// stale: an owner removed from an org mid-session loses access on their very
// next navigation, not whenever a stale cookie happens to expire.
//
// Multi-org membership is supported (org_members has no uniqueness
// constraint on user_id alone): a member of several orgs works in the one
// named by ACTIVE_ORG_COOKIE (set when they accept an invitation or switch
// on the Team page) when they still belong to it, else their oldest
// membership (first `created_at`).
export interface OrgContext {
  userId: string;
  orgId: string;
  orgName: string;
  // Any org_role value -- this used to be typed as 'owner' | 'member', which
  // hid the eight roles added in 20260806000018 from every caller.
  role: Role;
}

export async function requireOrgContext(): Promise<OrgContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const { data: memberships, error } = await supabase
    .from('org_members')
    .select('org_id, role, organizations(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load org membership: ${error.message}`);
  }

  const preferredOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const membership = memberships?.find((m) => m.org_id === preferredOrgId) ?? memberships?.[0];
  // Supabase's nested-select return shape is ambiguous for a to-one FK
  // relationship (it can type as an array) -- same normalization every other
  // nested select in this codebase does (see applications/page.tsx).
  const organization = membership
    ? Array.isArray(membership.organizations)
      ? membership.organizations[0]
      : membership.organizations
    : null;

  if (!membership || !organization) {
    redirect('/onboarding');
  }

  return {
    userId: user.id,
    orgId: membership.org_id,
    orgName: organization.name,
    role: membership.role as Role,
  };
}

// Weaker variant for pages that only need to know whether someone is signed
// in at all (e.g. /login, /onboarding itself) without forcing org membership
// to exist yet.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}
