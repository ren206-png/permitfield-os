'use server';

import { redirect } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { createCheckoutSessionUrl, createPortalSessionUrl } from '@/lib/billing/subscriptions';
import { isBillingTierId } from '@/lib/billing/tiers';

// BILLING_PROPOSAL.md §3. Both actions re-run requireOrgContext() and their
// own owner check rather than trusting the calling page already did --
// same "a Server Action is a public, directly-invokable endpoint on its
// own" discipline app/admin/client-portal/actions.ts's header comment
// documents. Owner-only: org_subscriptions' own SELECT policy is open to
// any org member (the billing *page* shows status to everyone), but
// initiating a Checkout or Portal session is a spend-affecting action
// reserved for the owner, enforced here at the Server Action layer (RLS
// has no notion of "owner vs member" write gate for this table -- there is
// no write policy for `authenticated` at all, see that migration's own
// header comment).

export interface BillingActionState {
  error?: string;
}

export async function checkoutAction(_prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const { orgId, orgName, role } = await requireOrgContext();
  if (role !== 'owner') {
    return { error: 'Only the organization owner can change the billing plan.' };
  }

  const tier = String(formData.get('tier') ?? '');
  if (!isBillingTierId(tier)) {
    return { error: 'Select a valid plan.' };
  }

  const supabase = await createClient();

  // Reused across an upgrade/downgrade so the same Stripe Customer keeps a
  // single payment method and invoice history, rather than Checkout minting
  // a new customer every time (createCheckoutSessionUrl's own doc comment).
  const { data: sub, error: subError } = await supabase
    .from('org_subscriptions')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (subError) {
    return { error: `Failed to load billing account: ${subError.message}` };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: 'Your account has no email on file -- cannot start checkout.' };
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await createCheckoutSessionUrl({
      orgId,
      orgName,
      tier,
      stripeCustomerId: sub?.stripe_customer_id ?? null,
      customerEmail: user.email,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to start checkout.' };
  }

  // Outside the try/catch on purpose -- redirect() throws a Next.js-internal
  // control-flow signal that a catch block here would otherwise swallow.
  redirect(checkoutUrl);
}

// Signature matches useActionState's (prevState, formData) contract even
// though this action needs neither -- PortalButton has no fields of its
// own to submit, same "explicitly void what the framework contract
// requires but the body doesn't use" discipline the pre-billing
// lib/entitlements/index.ts stub used for its own unused orgId parameter.
export async function portalAction(prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  void prevState;
  void formData;
  const { orgId, role } = await requireOrgContext();
  if (role !== 'owner') {
    return { error: 'Only the organization owner can manage the billing account.' };
  }

  const supabase = await createClient();
  const { data: sub, error: subError } = await supabase
    .from('org_subscriptions')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (subError) {
    return { error: `Failed to load billing account: ${subError.message}` };
  }
  if (!sub?.stripe_customer_id) {
    return { error: 'No billing account on file yet -- subscribe to a plan first.' };
  }

  let portalUrl: string;
  try {
    portalUrl = await createPortalSessionUrl(sub.stripe_customer_id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to open the billing portal.' };
  }

  redirect(portalUrl);
}
