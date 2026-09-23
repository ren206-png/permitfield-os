'use server';

import { redirect } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsOnlineEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createConnectOnboardingLink } from '@/lib/quotes-payments/stripe-connect';
import { SITE_URL } from '@/lib/seo';

// Gate 4 (Quotes & Payments), Phase C -- org-facing Connect onboarding
// start/resume action for app/(app)/settings/payments-online/page.tsx. Same
// double-gate discipline as app/(app)/invoices/[id]/actions.ts's own header
// comment: flag re-checked first (notFound-equivalent -- returning a typed
// error, since this is a Server Action, not a page), then the
// `payments.online` entitlement re-checked here AND again inside
// createConnectOnboardingLink() itself. The finer-grained "is this member
// actually an org owner/permit manager" role tier
// (is_org_billing_manager(), §I question 5) is NOT re-implemented here --
// the RPC that function calls is the final authority; a member without
// that role gets a thrown Postgres insufficient_privilege error, caught
// below and surfaced as a plain message, same posture as every other
// action in this gate.

export interface StartConnectOnboardingState {
  error?: string;
}

// Signature matches useActionState's (prevState, formData) contract even
// though this action needs neither -- OnboardingButton has no fields of its
// own to submit, same "explicitly void what the framework contract requires
// but the body doesn't use" discipline app/(app)/settings/billing/
// actions.ts's own portalAction already establishes.
export async function startConnectOnboardingAction(
  prevState: StartConnectOnboardingState,
  formData: FormData
): Promise<StartConnectOnboardingState> {
  void prevState;
  void formData;
  if (!isQuotesPaymentsOnlineEnabled()) {
    return { error: 'Online payment collection (PERMITFIELD_FF_QUOTES_PAYMENTS_ONLINE) is currently off.' };
  }

  const { orgId, orgName } = await requireOrgContext();
  if (!(await can(orgId, 'payments.online'))) {
    return { error: 'Your organization’s plan does not include online payment collection.' };
  }

  const supabase = await createClient();

  let onboardingUrl: string;
  try {
    onboardingUrl = await createConnectOnboardingLink(supabase, {
      orgId,
      orgName,
      refreshUrl: `${SITE_URL}/settings/payments-online`,
      returnUrl: `${SITE_URL}/settings/payments-online`,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to start Stripe Connect onboarding.' };
  }

  // Outside the try/catch on purpose -- redirect() throws a Next.js-internal
  // control-flow signal a catch block here would otherwise swallow, same
  // discipline as app/(app)/settings/billing/actions.ts's checkoutAction.
  redirect(onboardingUrl);
}
