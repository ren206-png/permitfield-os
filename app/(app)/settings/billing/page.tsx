import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isBillingEnabled } from '@/lib/flags';
import { createClient } from '@/lib/supabase/server';
import { BILLING_TIERS, SELF_SERVE_TIERS } from '@/lib/billing/tiers';
import { CheckoutButton } from './checkout-button';
import { PortalButton } from './portal-button';

// BILLING_PROPOSAL.md §3. Flag-gated the same way every other flag-gated
// page in this codebase is (see app/(app)/projects/new/page.tsx's header
// comment) -- notFound() means this route doesn't exist at all with
// PERMITFIELD_FF_BILLING off.
//
// Visible to every org member (org_subscriptions_select's own RLS policy
// is open to any member, not just the owner -- see that migration's header
// comment: "the /settings/billing page needs this for every member, not
// just the owner"). The Checkout/Portal action buttons are still rendered
// for everyone (a non-owner needs to know a plan exists and who to ask),
// but actions.ts's checkoutAction/portalAction independently reject a
// non-owner submission -- this page's owner check only decides copy, never
// authorization, matching the "RLS/Server-Action layer is the real gate,
// the page is not" discipline this codebase follows elsewhere.
export default async function BillingPage() {
  if (!isBillingEnabled()) {
    notFound();
  }

  const { orgId, role } = await requireOrgContext();
  const supabase = await createClient();

  const { data: subscription, error } = await supabase
    .from('org_subscriptions')
    .select('tier, status, stripe_customer_id, trial_ends_at, current_period_end')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load billing status: ${error.message}`);
  }

  const isOwner = role === 'owner';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Billing</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {isOwner
          ? 'Manage this organization&#39;s plan and payment method.'
          : 'Only the organization owner can change the plan or payment method.'}
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {!subscription ? (
          <p className="text-sm text-zinc-600">
            No billing record exists for this organization yet. This shouldn&#39;t happen for an org created after
            the billing build shipped -- contact support if you see this.
          </p>
        ) : (
          <BillingStatus
            tier={subscription.tier}
            status={subscription.status}
            trialEndsAt={subscription.trial_ends_at}
            currentPeriodEnd={subscription.current_period_end}
          />
        )}

        {isOwner && (
          <div className="mt-6 border-t border-zinc-200 pt-6">
            <h2 className="text-sm font-medium text-zinc-900">Change plan</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SELF_SERVE_TIERS.map((tierId) => {
                const tierInfo = BILLING_TIERS[tierId];
                return (
                  <div key={tierId} className="rounded-md border border-zinc-200 p-3">
                    <p className="text-sm font-medium text-zinc-900">{tierInfo.name}</p>
                    <p className="text-xs text-zinc-500">
                      {tierInfo.priceCents !== null ? `$${(tierInfo.priceCents / 100).toFixed(0)}/mo` : 'Custom'} &middot;{' '}
                      {tierInfo.limits['projects.active_max']} active projects
                    </p>
                    <div className="mt-3">
                      <CheckoutButton tier={tierId} label={`Switch to ${tierInfo.name}`} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Need Enterprise (unlimited projects, custom pricing)? Contact us -- Enterprise isn&#39;t self-serve.
            </p>

            {subscription?.stripe_customer_id && (
              <div className="mt-6">
                <PortalButton />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
};

function BillingStatus({
  tier,
  status,
  trialEndsAt,
  currentPeriodEnd,
}: {
  tier: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}) {
  const tierInfo = tier in BILLING_TIERS ? BILLING_TIERS[tier as keyof typeof BILLING_TIERS] : null;

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-zinc-500">Plan</dt>
        <dd className="font-medium text-zinc-900">{tierInfo?.name ?? tier}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-zinc-500">Status</dt>
        <dd className="font-medium text-zinc-900">{STATUS_LABEL[status] ?? status}</dd>
      </div>
      {status === 'trialing' && trialEndsAt && (
        <div className="flex justify-between">
          <dt className="text-zinc-500">Trial ends</dt>
          <dd className="font-medium text-zinc-900">{new Date(trialEndsAt).toLocaleDateString()}</dd>
        </div>
      )}
      {status === 'active' && currentPeriodEnd && (
        <div className="flex justify-between">
          <dt className="text-zinc-500">Renews</dt>
          <dd className="font-medium text-zinc-900">{new Date(currentPeriodEnd).toLocaleDateString()}</dd>
        </div>
      )}
    </dl>
  );
}
