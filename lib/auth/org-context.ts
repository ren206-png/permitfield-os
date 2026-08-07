import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Every (app) route needs "who is signed in, and which org are they acting
// as" before it can run a single RLS-scoped query. This is deliberately not
// cached in a cookie/JWT claim and re-derived from org_members on every call
// -- same "never trust client state for a security-relevant decision"
// discipline the Inngest functions apply to coverage_level (see audit.ts,
// generate-pdf.ts). Cheap (single indexed query) and correct beats cheap and
// stale: an owner removed from an org mid-session loses access on their very
// next navigation, not whenever a stale cookie happens to expire.
//
// Multi-org membership is fully supported by the schema (org_members has no
// uniqueness constraint on user_id alone), but this phase's UI doesn't yet
// have an org switcher -- a member of more than one org is deterministically
// pinned to their oldest membership (first `created_at`). That's a UI scoping
// choice, not a data-model limitation; adding a switcher later needs no
// migration.
export interface OrgContext {
  userId: string;
  orgId: string;
  orgName: string;
  role: 'owner' | 'member';
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
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load org membership: ${error.message}`);
  }

  const membership = memberships?.[0];
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
    role: membership.role,
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
