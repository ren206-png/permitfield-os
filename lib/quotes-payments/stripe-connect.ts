// Gate 4 (Quotes & Payments), Phase C -- Stripe Connect online payment
// collection for flow B (a contractor's own customer paying an issued
// invoice), per GATE_4_PHASE_C_FINDINGS.md §I ("implement all
// recommendations"). This is the SECOND module in this repo permitted to
// import the `stripe` package or read STRIPE_SECRET_KEY -- alongside
// lib/billing/subscriptions.ts (flow A) -- enforced by
// eslint.config.mjs's stripeClientRestriction, which this build widens to
// list this file too. The two modules are deliberately NOT merged: flow A
// is PermitField's own SaaS billing (subscriptions, org_subscriptions,
// STRIPE_WEBHOOK_SECRET), flow B is a contractor's customer paying THAT
// contractor via a Connect sub-account (org_stripe_connect_accounts,
// STRIPE_CONNECT_WEBHOOK_SECRET, a separate webhook endpoint) -- see
// GATE_4_FINDINGS.md §2's "never conflate the two flows" instruction and
// this repo's AGENTS.md-adjacent convention of one dedicated client module
// per external integration (lib/ai/gemini/client.ts,
// lib/bridge/client-portal.ts).
//
// §I question 3's entitlement split (this module's central design
// constraint): every function here that is called by a real authenticated
// org actor (onboarding start, status read for the settings page, a
// staff-initiated refund) asserts `payments.online` via
// assertOnlinePaymentsEntitlement() below. createInvoiceCheckoutSessionUrl()
// is the one deliberate exception -- it is called from the customer-facing,
// unauthenticated app/invoice/[token]/page.tsx "Pay now" affordance, which
// has no `auth.uid()` and therefore cannot pass `can(orgId, ...)`'s
// actor-shape at all. That call site instead gates on
// isQuotesPaymentsOnlineEnabled() (the same flag, checked at the page level)
// plus a data-level precondition (a connected account exists and
// charges_enabled is true) -- see that recommendation for why an entitlement
// check would be the wrong tool there, not merely a redundant one.
//
// Architecture note (destination charges, not direct charges): Checkout
// Sessions created here use `payment_intent_data.transfer_data.destination`
// (the connected account) from THIS module's own Stripe client (the
// platform's secret key), rather than a `Stripe-Account` header / direct
// charge on the connected account itself. This means `payment_intent.
// succeeded` and `charge.refunded` events land on the PLATFORM account's own
// webhook stream -- exactly the stream app/api/webhooks/stripe-connect/
// route.ts listens to below with no extra configuration. The one Stripe
// object this module does NOT control the delivery of is
// `account.updated` for a connected account's own KYC/onboarding status --
// Stripe only sends that to a webhook endpoint the Dashboard has been
// configured, by a human, to "listen to events on connected accounts" (this
// is an operational step with no code-expressible equivalent; the endpoint
// URL is the same app/api/webhooks/stripe-connect/route.ts either way, since
// handleStripeConnectWebhookEvent() below already branches on event.type).
import Stripe from 'stripe';
import { isQuotesPaymentsOnlineEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToSafeNumber } from '@/lib/money/cents';
import { createServiceClient } from '@/lib/supabase/service-client';
import { reversePayment, type PaymentRecord } from './payments';
import { InsufficientEntitlementError } from './estimates';
import type { QPClient } from './types';
import type { Role } from '@/lib/authz';

export class QuotesPaymentsOnlineDisabledError extends Error {
  constructor() {
    super('Online payment collection is disabled (PERMITFIELD_FF_QUOTES_PAYMENTS_ONLINE is not "true").');
    this.name = 'QuotesPaymentsOnlineDisabledError';
  }
}

/** Org-facing Connect administration gate (§I question 3) -- NOT used by createInvoiceCheckoutSessionUrl(), see this module's header comment. */
async function assertOnlinePaymentsEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsOnlineEnabled()) {
    throw new QuotesPaymentsOnlineDisabledError();
  }
  if (!(await can(orgId, 'payments.online'))) {
    throw new InsufficientEntitlementError(orgId, 'payments.online');
  }
}

// Constructed lazily, same "fail at point of use, not at import time"
// discipline as lib/billing/subscriptions.ts's own getStripeClient() -- the
// two are intentionally not shared/exported from a common location, so each
// module's import boundary stays independently enforceable by eslint.
function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  return new Stripe(key);
}

export interface OrgStripeConnectAccountStatus {
  stripeConnectAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConnectAccountRow(row: any): OrgStripeConnectAccountStatus {
  return {
    stripeConnectAccountId: row.stripe_connect_account_id,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted: row.details_submitted,
  };
}

/**
 * Reads the org's Connect account status, if any -- an ordinary RLS-enforced
 * SELECT (org_stripe_connect_accounts_select policy: any org member), not an
 * RPC. Used both by the org-facing settings page (gated by the entitlement
 * assertion below) and, per this module's header comment, by
 * createInvoiceCheckoutSessionUrl()'s own data-level precondition (which
 * calls this with a service-role client instead, bypassing the entitlement
 * check for that one customer-facing call site).
 */
export async function getOrgStripeConnectAccountStatus(
  supabase: QPClient,
  orgId: string
): Promise<OrgStripeConnectAccountStatus | null> {
  const { data, error } = await supabase
    .from('org_stripe_connect_accounts')
    .select('stripe_connect_account_id, charges_enabled, payouts_enabled, details_submitted')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read org_stripe_connect_accounts for org ${orgId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapConnectAccountRow(data);
}

export interface CreateConnectOnboardingLinkParams {
  orgId: string;
  orgName: string;
  refreshUrl: string;
  returnUrl: string;
}

/**
 * Starts (or resumes) Standard Connect onboarding (§I question 5) for an
 * org's own Stripe sub-account -- creates the Connect account on first call,
 * upserts the org<->account link via upsert_org_stripe_connect_account()
 * (is_org_billing_manager()-gated, same role tier record_payment()/
 * org_tax_profiles writes already use), then returns a fresh Account Link
 * URL. Reuses the existing account id on a resumed/interrupted flow rather
 * than creating a second Stripe account for the same org.
 */
export async function createConnectOnboardingLink(
  supabase: QPClient,
  params: CreateConnectOnboardingLinkParams
): Promise<string> {
  await assertOnlinePaymentsEntitlement(params.orgId);

  const stripe = getStripeClient();
  const existing = await getOrgStripeConnectAccountStatus(supabase, params.orgId);

  let accountId = existing?.stripeConnectAccountId ?? null;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'standard',
      business_profile: { name: params.orgName },
    });
    accountId = account.id;
  }

  const { error: rpcError } = await supabase.rpc('upsert_org_stripe_connect_account', {
    p_org_id: params.orgId,
    p_stripe_connect_account_id: accountId,
  });
  if (rpcError) {
    throw new Error(`upsert_org_stripe_connect_account RPC failed for org ${params.orgId}: ${rpcError.message}`);
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: params.refreshUrl,
    return_url: params.returnUrl,
    type: 'account_onboarding',
  });

  return accountLink.url;
}

export interface CreateInvoiceCheckoutSessionInput {
  orgId: string;
  stripeConnectAccountId: string;
  invoiceId: string;
  clientId: string;
  amountCents: bigint;
  invoiceLabel: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Creates a one-time-payment-mode Checkout Session for a single invoice's
 * outstanding balance, using destination charges (this module's header
 * comment) to the org's own connected account, at
 * `application_fee_amount: 0` (§I question 6 -- platform fee deferred to a
 * future build, not invented here). Deliberately has NO entitlement check
 * (§I question 3) -- the caller (app/invoice/[token]/page.tsx) is an
 * unauthenticated customer following an emailed invoice link, not an org
 * actor; the flag check and the "does this org actually have a
 * charges-enabled connected account" precondition both happen at that call
 * site, before this function is ever reached, using a service-role read of
 * getOrgStripeConnectAccountStatus() above.
 *
 * Scoped to exactly one invoice (§I question 7 -- invoices only, no
 * estimate deposits), matching record_online_payment()'s own one-invoice-
 * per-call shape in the migration this mirrors.
 */
export async function createInvoiceCheckoutSessionUrl(input: CreateInvoiceCheckoutSessionInput): Promise<string> {
  const stripe = getStripeClient();

  const metadata = {
    org_id: input.orgId,
    invoice_id: input.invoiceId,
    client_id: input.clientId,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    line_items: [
      {
        price_data: {
          currency: 'cad',
          unit_amount: centsToSafeNumber(input.amountCents),
          product_data: {
            name: input.invoiceLabel,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // Deferred per §I question 6 -- ship v1 with no platform fee. Kept
      // explicit (not omitted) so a future build turning this on is a
      // one-line diff against a value already present, not a new field.
      application_fee_amount: 0,
      transfer_data: {
        destination: input.stripeConnectAccountId,
      },
      metadata,
    },
    // Mirrored onto the Session's own top-level metadata too, following
    // lib/billing/subscriptions.ts's own "carry metadata redundantly"
    // precedent -- session.metadata is convenient for
    // checkout.session.completed handlers, but this module's webhook
    // handler below reads the PaymentIntent object directly
    // (payment_intent.succeeded), which needs its own metadata copy
    // regardless.
    metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout Session URL.');
  }
  return session.url;
}

export interface RefundOnlinePaymentParams {
  orgId: string;
  paymentId: string;
  reversalReason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/**
 * Staff-initiated refund path (§I question 4's PRIMARY path, not the
 * webhook backstop) -- a real authenticated org actor clicks "refund" in
 * the settings UI. Calls Stripe's refund API FIRST, then
 * reversePayment() (lib/quotes-payments/payments.ts, UNCHANGED) SECOND --
 * this order is deliberate: if the Stripe call fails, nothing in this
 * repo's ledger has changed yet (safe to retry); if the Stripe call
 * succeeds but the subsequent reversePayment() call fails, the ledger is
 * merely stale (an admin can retry reversePayment() alone, or the
 * charge.refunded webhook backstop -- reverse_online_payment_from_webhook()
 * -- corrects it), which is a far safer failure mode than reversing the
 * ledger and then failing to actually refund the customer's money.
 */
export async function refundOnlinePayment(supabase: QPClient, params: RefundOnlinePaymentParams): Promise<PaymentRecord> {
  await assertOnlinePaymentsEntitlement(params.orgId);

  const { data: paymentRow, error: fetchError } = await supabase
    .from('payments')
    .select('id, org_id, method, status, stripe_payment_intent_id')
    .eq('id', params.paymentId)
    .eq('org_id', params.orgId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to read payment ${params.paymentId} for org ${params.orgId}: ${fetchError.message}`);
  }
  if (!paymentRow) {
    throw new Error(`Payment ${params.paymentId} not found in org ${params.orgId}.`);
  }
  if (paymentRow.method !== 'card' || !paymentRow.stripe_payment_intent_id) {
    throw new Error(`Payment ${params.paymentId} is not an online (card) payment -- use reversePayment() for manual payments instead.`);
  }
  if (paymentRow.status !== 'recorded') {
    throw new Error(`Payment ${params.paymentId} is not in "recorded" status (current: ${paymentRow.status}); cannot refund.`);
  }

  const stripe = getStripeClient();
  await stripe.refunds.create({
    payment_intent: paymentRow.stripe_payment_intent_id,
  });

  return reversePayment(supabase, {
    orgId: params.orgId,
    paymentId: params.paymentId,
    reversalReason: params.reversalReason ?? null,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
  });
}

const RELEVANT_EVENT_TYPES = new Set(['payment_intent.succeeded', 'account.updated', 'charge.refunded']);

/**
 * Verifies the Stripe signature against the raw request body (same
 * byte-exact requirement as lib/billing/subscriptions.ts's own
 * handleStripeWebhookEvent() -- see that function's header comment), using
 * a SEPARATE secret (STRIPE_CONNECT_WEBHOOK_SECRET) and a SEPARATE endpoint
 * (app/api/webhooks/stripe-connect/route.ts) from flow A's webhook, per
 * GATE_4_FINDINGS.md §2.
 */
export async function handleStripeConnectWebhookEvent(rawBody: string, signature: string): Promise<void> {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET is not configured.');
  }

  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (!RELEVANT_EVENT_TYPES.has(event.type)) {
    return;
  }

  const supabase = createServiceClient();

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const { error } = await supabase.rpc('update_org_stripe_connect_account_status', {
      p_stripe_connect_account_id: account.id,
      p_charges_enabled: account.charges_enabled ?? false,
      p_payouts_enabled: account.payouts_enabled ?? false,
      p_details_submitted: account.details_submitted ?? false,
    });
    if (error) {
      // Thrown, not logged-and-skipped -- an account.updated event for an
      // account this app doesn't recognize is a data-integrity surprise
      // (see the RPC's own header comment), not a routine no-op.
      throw new Error(`update_org_stripe_connect_account_status RPC failed for account ${account.id}: ${error.message}`);
    }
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orgId = pi.metadata?.org_id;
    const invoiceId = pi.metadata?.invoice_id;
    const clientId = pi.metadata?.client_id;

    if (!orgId || !invoiceId || !clientId) {
      // Not a PaymentIntent this module created (e.g. a destination charge
      // for something else entirely under this platform account) -- log and
      // skip, same "unrecognized shape is routine, not an error" posture as
      // lib/billing/subscriptions.ts's own metadata-missing branches.
      console.error('Stripe Connect webhook: payment_intent.succeeded missing expected org/invoice/client metadata', {
        paymentIntentId: pi.id,
      });
      return;
    }

    const { error } = await supabase.rpc('record_online_payment', {
      p_org_id: orgId,
      p_client_id: clientId,
      p_invoice_id: invoiceId,
      p_amount_cents: pi.amount_received,
      p_stripe_payment_intent_id: pi.id,
    });
    if (error) {
      throw new Error(`record_online_payment RPC failed for payment_intent ${pi.id}: ${error.message}`);
    }
    return;
  }

  // charge.refunded: the defensive backstop only (§I question 4) -- a
  // refund issued directly from the Stripe Dashboard, outside this app's
  // own refundOnlinePayment() path. Caught and logged rather than thrown --
  // "no payment found for this payment_intent" is realistically either a
  // refund for a PaymentIntent this app never recorded (e.g. a $0
  // authorization-only charge) or a genuine ordering race, neither of which
  // should fail this webhook delivery and trigger Stripe's retry storm the
  // way a record_online_payment/update_org_stripe_connect_account_status
  // failure above should.
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) {
    console.error('Stripe Connect webhook: charge.refunded has no payment_intent id', { chargeId: charge.id });
    return;
  }

  const { error } = await supabase.rpc('reverse_online_payment_from_webhook', {
    p_stripe_payment_intent_id: paymentIntentId,
  });
  if (error) {
    console.error('Stripe Connect webhook: reverse_online_payment_from_webhook RPC failed', {
      paymentIntentId,
      message: error.message,
    });
  }
}
