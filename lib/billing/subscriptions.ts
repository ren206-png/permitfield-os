// BILLING_PROPOSAL.md §3: the ONE module in this repo permitted to import
// the `stripe` package or read STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET --
// enforced by eslint.config.mjs's stripeClientRestriction, same shape and
// mechanism as lib/ai/gemini/client.ts's geminiClientRestriction and
// lib/bridge/client-portal.ts's clientPortalServiceClientRestriction. Every
// other file that needs a Checkout/Portal URL or webhook processing must go
// through the three functions exported here.
//
// Stripe is the source of truth for subscription state (BILLING_PROPOSAL.md
// §3); org_subscriptions is a synced mirror only. The webhook handler here
// is the ONLY writer of that table -- it uses
// lib/supabase/service-client.ts's service-role client, sanctioned per that
// module's own header comment specifically for "background/webhook/cron"
// contexts with no end-user session, exactly this route's shape.
// createCheckoutSessionUrl/createPortalSessionUrl do not touch the DB at
// all; their callers (app/(app)/settings/billing/actions.ts) read
// stripe_customer_id themselves via the session-scoped, RLS-respecting
// client before calling in.
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/service-client';
import { SITE_URL } from '@/lib/seo';
import {
  BILLING_TIERS,
  SELF_SERVE_TIERS,
  type BillingTierId,
  isBillingTierId,
} from '@/lib/billing/tiers';

// Constructed lazily (not at module load) so importing this module never
// throws in an environment that hasn't set STRIPE_SECRET_KEY yet -- same
// "fail at the point of use, not at import time" discipline
// lib/supabase/service-client.ts's createServiceClient() already follows
// for its own env vars.
function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  return new Stripe(key);
}

export interface CreateCheckoutSessionInput {
  orgId: string;
  orgName: string;
  tier: BillingTierId;
  /** Existing Stripe customer id for this org, if any (reuse across upgrades). */
  stripeCustomerId: string | null;
  /** Only used when stripeCustomerId is null -- prefills Stripe's own email field. */
  customerEmail: string;
}

// Creates a Checkout Session (subscription mode) and returns its hosted-page
// URL -- the caller (a Server Action) redirects the org owner there. Uses
// inline `price_data` rather than a pre-created Stripe Price ID
// (BILLING_PROPOSAL.md §3) so nothing needs configuring in the Stripe
// Dashboard beyond an API key -- every tier's price lives in
// lib/billing/tiers.ts, not in Stripe's own product catalog.
export async function createCheckoutSessionUrl(input: CreateCheckoutSessionInput): Promise<string> {
  if (!SELF_SERVE_TIERS.includes(input.tier)) {
    throw new Error(`Tier "${input.tier}" has no self-serve Checkout flow (BILLING_PROPOSAL.md §2/§3).`);
  }

  const tierInfo = BILLING_TIERS[input.tier];
  if (tierInfo.priceCents === null) {
    throw new Error(`Tier "${input.tier}" has no self-serve price.`);
  }

  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    // client_reference_id and the metadata below are both set to the same
    // org_id so the webhook handler can resolve the org regardless of which
    // event/object it reads it off of (checkout.session.completed carries
    // client_reference_id directly; subscription.updated/deleted only ever
    // see the subscription object, hence subscription_data.metadata below).
    client_reference_id: input.orgId,
    ...(input.stripeCustomerId
      ? { customer: input.stripeCustomerId }
      : { customer_email: input.customerEmail }),
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: tierInfo.priceCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `PermitField OS -- ${tierInfo.name}`,
          },
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: { org_id: input.orgId, tier: input.tier },
    },
    metadata: { org_id: input.orgId, tier: input.tier },
    success_url: `${SITE_URL}/settings/billing?checkout=success`,
    cancel_url: `${SITE_URL}/settings/billing?checkout=canceled`,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout Session URL.');
  }
  return session.url;
}

// Creates a Billing Portal session scoped to payment-method update and
// cancellation (BILLING_PROPOSAL.md §3 -- not plan-switching, which stays on
// the Checkout path above so no Stripe Dashboard "portal configuration" of
// Price IDs is required).
export async function createPortalSessionUrl(stripeCustomerId: string): Promise<string> {
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${SITE_URL}/settings/billing`,
  });
  return session.url;
}

const RELEVANT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

// Verifies the Stripe signature against the RAW request body (not parsed
// JSON -- Stripe's SDK recomputes the HMAC over the exact bytes it sent;
// re-serializing a parsed body almost never byte-matches, the specific
// integration bug BILLING_PROPOSAL.md §3's research called out), then
// upserts org_subscriptions accordingly. Idempotent by (org_id) primary key
// upsert -- Stripe explicitly guarantees at-least-once delivery, not
// exactly-once, so this function may run twice for the same event and must
// be safe to do so.
//
// `rawBody` must be the literal request body text/bytes exactly as
// received, not JSON.stringify(await request.json()) -- see
// app/api/webhooks/stripe/route.ts's own header comment for how it's
// obtained.
export async function handleStripeWebhookEvent(rawBody: string, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  }

  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (!RELEVANT_EVENT_TYPES.has(event.type)) {
    return;
  }

  const supabase = createServiceClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.client_reference_id ?? session.metadata?.org_id;
    const tier = session.metadata?.tier;
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (!orgId || !tier || !isBillingTierId(tier) || !subscriptionId || !customerId) {
      // Not a shape this handler recognizes (e.g. a Checkout Session created
      // outside this app, or a one-time-payment mode session) -- log and
      // skip rather than throw, so an unrelated Stripe account event never
      // fails the webhook delivery and triggers Stripe's own retry storm.
      console.error('Stripe webhook: checkout.session.completed missing expected org/tier metadata', {
        sessionId: session.id,
      });
      return;
    }

    // The subscription itself carries the authoritative status/period-end;
    // Checkout completing doesn't necessarily mean the subscription is
    // already 'active' (e.g. a 3DS confirmation still pending), so fetch it
    // rather than assuming.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertOrgSubscription(supabase, {
      orgId,
      tier,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: subscription.status,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? null,
      trialEndsAt: subscription.trial_end,
    });
    return;
  }

  // customer.subscription.updated / customer.subscription.deleted both
  // carry the full subscription object with the org_id/tier metadata this
  // module set at Checkout time (subscription_data.metadata above).
  const subscription = event.data.object as Stripe.Subscription;
  const orgId = subscription.metadata?.org_id;
  const tierMeta = subscription.metadata?.tier;

  if (!orgId || !tierMeta || !isBillingTierId(tierMeta)) {
    console.error(`Stripe webhook: ${event.type} missing expected org/tier metadata`, {
      subscriptionId: subscription.id,
    });
    return;
  }

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  await upsertOrgSubscription(supabase, {
    orgId,
    tier: tierMeta,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    // 'deleted' isn't a Stripe subscription.status value -- customer.
    // subscription.deleted's own object still reports whatever status it
    // had at cancellation (usually 'canceled' already), but this is
    // asserted explicitly rather than trusted, since a hard-deleted
    // subscription must always resolve to 'canceled' in our mirror
    // regardless of what the payload says.
    status: event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status,
    currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? null,
    trialEndsAt: subscription.trial_end,
  });

  // invoice.payment_failed is handled by the customer.subscription.updated
  // event Stripe also sends for the same failure (status transitions to
  // 'past_due'), so no separate branch is needed here -- this function
  // still logs it for operator visibility. Dunning emails / an in-app
  // banner are explicitly out of scope for this build (BILLING_PROPOSAL.md
  // §3), future work.
  if (event.type === 'invoice.payment_failed') {
    console.error('Stripe webhook: invoice.payment_failed', { orgId, subscriptionId: subscription.id });
  }
}

interface UpsertOrgSubscriptionInput {
  orgId: string;
  tier: BillingTierId;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd: number | null;
  trialEndsAt: number | null;
}

async function upsertOrgSubscription(
  supabase: ReturnType<typeof createServiceClient>,
  input: UpsertOrgSubscriptionInput
): Promise<void> {
  const mirroredStatus = ['trialing', 'active', 'past_due', 'canceled'].includes(input.status)
    ? input.status
    : // Any other Stripe status (incomplete, incomplete_expired, unpaid,
      // paused) isn't one of org_subscriptions.status's four enum values --
      // fail closed to 'canceled' rather than let an unrecognized status
      // write fail the whole upsert.
      'canceled';

  const { error } = await supabase
    .from('org_subscriptions')
    .update({
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      tier: input.tier,
      status: mirroredStatus,
      current_period_end: input.currentPeriodEnd ? new Date(input.currentPeriodEnd * 1000).toISOString() : null,
      trial_ends_at: input.trialEndsAt ? new Date(input.trialEndsAt * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', input.orgId);

  if (error) {
    throw new Error(`Failed to upsert org_subscriptions for org ${input.orgId}: ${error.message}`);
  }
}
