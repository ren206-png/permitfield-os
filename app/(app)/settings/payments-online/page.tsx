import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsOnlineEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createClient } from '@/lib/supabase/server';
import { getOrgStripeConnectAccountStatus } from '@/lib/quotes-payments/stripe-connect';
import { OnboardingButton } from './onboarding-button';

// Gate 4 (Quotes & Payments), Phase C -- org-facing Stripe Connect
// onboarding/administration surface, per GATE_4_PHASE_C_FINDINGS.md §I
// question 5's recommendation to mirror
// app/(app)/settings/billing/page.tsx's existing pattern (flag-gated
// notFound(), requireOrgContext(), a status card, an action button). A
// deliberately SEPARATE settings route from /settings/billing -- this page
// administers flow B (a contractor's own Stripe sub-account for collecting
// payment from ITS customers), not flow A (PermitField's own SaaS
// subscription) -- see lib/quotes-payments/stripe-connect.ts's header
// comment for why the two flows/modules/webhooks all stay structurally
// separate.
//
// Visible to any org member with the `payments.online` entitlement (read
// access mirrors org_stripe_connect_accounts_select's own RLS policy: any
// org member) -- same "read is open to the org, write is the narrower
// is_org_billing_manager() tier" split this page's own action
// (actions.ts's startConnectOnboardingAction) enforces at the RPC layer,
// not here. A member without that specific role tier can still see this
// page and click the button; the RPC rejects the write with a thrown
// insufficient_privilege error, surfaced as a plain message by
// OnboardingButton -- this page's own checks decide visibility/copy, never
// authorization, matching the discipline app/(app)/settings/billing/page.tsx
// itself already documents.
export default async function PaymentsOnlinePage() {
  if (!isQuotesPaymentsOnlineEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'payments.online');

  const supabase = await createClient();
  const status = hasEntitlement ? await getOrgStripeConnectAccountStatus(supabase, orgId) : null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Online payments</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Let your clients pay invoices online by card, via Stripe. Money goes directly to your own Stripe account --
        PermitField never holds it.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {!hasEntitlement ? (
          <p className="text-sm text-zinc-600">
            Your organization’s plan does not include online payment collection. Upgrade your plan to turn this on.
          </p>
        ) : !status ? (
          <>
            <p className="text-sm text-zinc-600">
              You haven’t connected a Stripe account yet. Connecting takes a few minutes and lets your clients pay
              issued invoices with a card directly from their invoice link.
            </p>
            <div className="mt-4">
              <OnboardingButton label="Connect Stripe" />
            </div>
          </>
        ) : status.chargesEnabled ? (
          <>
            <p className="text-sm font-medium text-emerald-700">Connected -- ready to accept payments.</p>
            <p className="mt-1 text-xs text-zinc-500">Stripe account: {status.stripeConnectAccountId}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-amber-700">Onboarding started, but not finished yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Stripe still needs a bit more information before this account can accept payments.
            </p>
            <div className="mt-4">
              <OnboardingButton label="Continue onboarding" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
