// Run via `npm run test:live` (vitest.live.config.mts) -- see
// lib/bridge/client-portal.live.test.ts's header for the two-stack setup
// this repo's live tests share, and lib/billing/subscriptions.live.test.ts
// for the sibling flow-A test this one mirrors line-for-line in structure
// (fake Stripe keys, a real local-HMAC-signed webhook payload,
// handleStripe*WebhookEvent() exercised for real against a real local
// Postgres, no live Stripe network call anywhere). This file only touches
// project 1 (the main app's Supabase project); it has no
// CLIENT_PORTAL_SUPABASE_* dependency.
//
// Covers handleStripeConnectWebhookEvent()'s three branches
// (account.updated, payment_intent.succeeded, charge.refunded) end to end,
// including the two RPCs each of the latter two calls
// (record_online_payment(), reverse_online_payment_from_webhook()) and the
// idempotency guarantee both are documented to provide for Stripe's
// at-least-once delivery. Does NOT cover createConnectOnboardingLink() or
// createInvoiceCheckoutSessionUrl() -- both make a real network call to
// Stripe's API (accounts.create/accountLinks.create/checkout.sessions.create)
// that needs real account credentials, out of scope for a local/CI live-DB
// test, same "no live Stripe network call" boundary
// subscriptions.live.test.ts's own header draws for
// checkout.session.completed.
//
// STRIPE_SECRET_KEY/STRIPE_CONNECT_WEBHOOK_SECRET: handleStripeConnectWebhookEvent()
// reads both directly from process.env, and getStripeClient() only ever
// uses the key to construct a Stripe SDK instance -- never a network call
// for any branch under test here (stripe.webhooks.constructEvent/
// generateTestHeaderString are pure local HMAC computations). Deliberately
// a DIFFERENT webhook secret variable name than
// subscriptions.live.test.ts's STRIPE_WEBHOOK_SECRET, matching
// stripe-connect.ts's own header comment on why the two flows' webhook
// secrets stay separate. Set directly on process.env (not .env.local) so
// this file is self-contained.
process.env.STRIPE_SECRET_KEY ??= 'sk_test_stripe_client_lives_here_only_51H0';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET ??= 'whsec_test_stripe_connect_live_test_secret';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/service-client';
import { handleStripeConnectWebhookEvent } from './stripe-connect';

// supabase/seed.sql PART 2 fixture -- same Org A identity every other live
// test in this repo relies on (see subscriptions.live.test.ts's own
// comment). org_stripe_connect_accounts.org_id is a PRIMARY KEY referencing
// organizations(id), so this file upserts (never plain-inserts) into it
// keyed on ORG_A_ID, with a freshly randomized stripe_connect_account_id
// each run -- safe across reruns because update_org_stripe_connect_account_status()
// below is looked up by THAT fresh account id, never by org_id, so one
// run's leftover row can never collide with the next run's lookup.
//
// clients/invoices, by contrast, get a brand-new random-UUID row every run
// (service_role holds insert/update grants on both, migrations 19/54) --
// unlike org_stripe_connect_accounts there is no natural per-org fixture to
// reuse, and payments/payment_allocations are append-only (no DELETE grant
// for service_role), so reusing one fixed invoice across reruns would mean
// each run's "outstanding balance" shrinks and eventually the
// over-allocation guard rejects a perfectly valid test payment. A fresh
// invoice per run sidesteps that entirely.
const ORG_A_ID = '20000000-0000-0000-0000-00000000000a';

const main = createServiceClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function signPayload(payload: string): string {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
  });
}

async function fetchConnectAccount(orgId: string) {
  const { data, error } = await main.from('org_stripe_connect_accounts').select('*').eq('org_id', orgId).single();
  if (error || !data) {
    throw new Error(`failed to read back org_stripe_connect_accounts row for org ${orgId}: ${error?.message}`);
  }
  return data;
}

async function fetchPaymentByIntentId(stripePaymentIntentId: string) {
  const { data, error } = await main.from('payments').select('*').eq('stripe_payment_intent_id', stripePaymentIntentId).single();
  if (error || !data) {
    throw new Error(`failed to read back payments row for stripe_payment_intent_id ${stripePaymentIntentId}: ${error?.message}`);
  }
  return data;
}

async function createIssuedInvoiceFixture(issuedTotalCents: number): Promise<{ clientId: string; invoiceId: string }> {
  const clientId = randomUUID();
  const invoiceId = randomUUID();

  const { error: clientError } = await main.from('clients').insert({ id: clientId, org_id: ORG_A_ID, name: 'Stripe Connect live-test client' });
  if (clientError) {
    throw new Error(`failed to create client fixture: ${clientError.message}`);
  }

  const { error: invoiceInsertError } = await main.from('invoices').insert({ id: invoiceId, org_id: ORG_A_ID, client_id: clientId });
  if (invoiceInsertError) {
    throw new Error(`failed to create invoice fixture: ${invoiceInsertError.message}`);
  }

  const { error: invoiceUpdateError } = await main
    .from('invoices')
    .update({
      status: 'issued',
      // Bypasses issue_invoice()'s real per-org invoice_number_counters
      // sequence entirely (a direct fixture write, not the RPC) -- a
      // Date.now()-plus-random value is collision-resistant enough for
      // (org_id, invoice_number)'s unique constraint across the several
      // fixtures this file creates per run, without needing a shared
      // counter.
      invoice_number: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      issued_at: new Date().toISOString(),
      issued_line_items: [],
      issued_total_cents: issuedTotalCents,
      total_cents: issuedTotalCents,
    })
    .eq('id', invoiceId);
  if (invoiceUpdateError) {
    throw new Error(`failed to issue invoice fixture: ${invoiceUpdateError.message}`);
  }

  return { clientId, invoiceId };
}

// Minimal-but-real-shaped Stripe.Account event payload for account.updated --
// only the three fields update_org_stripe_connect_account_status() reads.
function buildAccountUpdatedPayload(opts: {
  eventId: string;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: 'account.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.accountId,
        object: 'account',
        charges_enabled: opts.chargesEnabled,
        payouts_enabled: opts.payoutsEnabled,
        details_submitted: opts.detailsSubmitted,
      },
    },
  });
}

// Minimal-but-real-shaped Stripe.PaymentIntent event payload for
// payment_intent.succeeded -- only the fields
// handleStripeConnectWebhookEvent()/record_online_payment() actually read.
// `metadata` omitted entirely (rather than set to an empty object) when the
// caller wants to exercise the "missing metadata" skip branch.
function buildPaymentIntentSucceededPayload(opts: {
  eventId: string;
  paymentIntentId: string;
  amountReceived: number;
  metadata?: { org_id: string; invoice_id: string; client_id: string };
}): string {
  return JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.paymentIntentId,
        object: 'payment_intent',
        amount_received: opts.amountReceived,
        metadata: opts.metadata ?? null,
      },
    },
  });
}

// Minimal-but-real-shaped Stripe.Charge event payload for charge.refunded --
// only the field reverse_online_payment_from_webhook() is looked up by.
function buildChargeRefundedPayload(opts: { eventId: string; chargeId: string; paymentIntentId: string | null }): string {
  return JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: 'charge.refunded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.chargeId,
        object: 'charge',
        payment_intent: opts.paymentIntentId,
      },
    },
  });
}

describe('handleStripeConnectWebhookEvent (live)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('account.updated upserts charges_enabled/payouts_enabled/details_submitted onto org_stripe_connect_accounts', async () => {
    const accountId = `acct_test_${randomUUID()}`;

    // Fixture: a row must already exist for this account id --
    // update_org_stripe_connect_account_status() UPDATEs, it does not
    // INSERT (see this migration's own header comment on why an
    // account.updated for an unrecognized account id is a data-integrity
    // surprise, not a routine no-op). Written directly via the service
    // client (bypasses RLS, same as every other service-role fixture write
    // in this file) rather than upsert_org_stripe_connect_account() --
    // that RPC's own is_org_billing_manager() check reads auth.uid(),
    // which is NULL for a session-less service-role connection, so it
    // cannot be used to seed this fixture from here.
    const { error: seedError } = await main
      .from('org_stripe_connect_accounts')
      .upsert({ org_id: ORG_A_ID, stripe_connect_account_id: accountId, charges_enabled: false, payouts_enabled: false, details_submitted: false });
    if (seedError) {
      throw new Error(`failed to seed org_stripe_connect_accounts fixture: ${seedError.message}`);
    }

    const payload = buildAccountUpdatedPayload({
      eventId: `evt_test_${randomUUID()}`,
      accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await handleStripeConnectWebhookEvent(payload, signPayload(payload));

    const row = await fetchConnectAccount(ORG_A_ID);
    expect(row.stripe_connect_account_id).toBe(accountId);
    expect(row.charges_enabled).toBe(true);
    expect(row.payouts_enabled).toBe(true);
    expect(row.details_submitted).toBe(true);
  });

  test('account.updated for an unrecognized account id throws (fail loud, not a silent no-op)', async () => {
    const payload = buildAccountUpdatedPayload({
      eventId: `evt_test_${randomUUID()}`,
      accountId: `acct_test_unrecognized_${randomUUID()}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await expect(handleStripeConnectWebhookEvent(payload, signPayload(payload))).rejects.toThrow(
      /update_org_stripe_connect_account_status RPC failed/
    );
  });

  test('payment_intent.succeeded records a card payment via record_online_payment, and is idempotent on redelivery', async () => {
    const { clientId, invoiceId } = await createIssuedInvoiceFixture(100_000);
    const paymentIntentId = `pi_test_${randomUUID()}`;
    const metadata = { org_id: ORG_A_ID, invoice_id: invoiceId, client_id: clientId };

    const payload = buildPaymentIntentSucceededPayload({
      eventId: `evt_test_${randomUUID()}`,
      paymentIntentId,
      amountReceived: 50_000,
      metadata,
    });
    await handleStripeConnectWebhookEvent(payload, signPayload(payload));

    const payment = await fetchPaymentByIntentId(paymentIntentId);
    expect(payment.status).toBe('recorded');
    expect(payment.method).toBe('card');
    expect(payment.amount_cents).toBe(50_000);

    const { data: allocations, error: allocationsError } = await main
      .from('payment_allocations')
      .select('amount_cents, invoice_id')
      .eq('payment_id', payment.id);
    if (allocationsError) {
      throw new Error(`failed to read back payment_allocations: ${allocationsError.message}`);
    }
    expect(allocations).toHaveLength(1);
    expect(allocations?.[0]?.amount_cents).toBe(50_000);
    expect(allocations?.[0]?.invoice_id).toBe(invoiceId);

    // Redelivery: same event id/payment_intent id (Stripe's at-least-once
    // guarantee) must return/leave the original row untouched, never
    // double-insert a second payment for the same PaymentIntent.
    await handleStripeConnectWebhookEvent(payload, signPayload(payload));

    const { data: allPaymentsForIntent, error: recheckError } = await main
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntentId);
    if (recheckError) {
      throw new Error(`failed to re-read payments for idempotency check: ${recheckError.message}`);
    }
    expect(allPaymentsForIntent).toHaveLength(1);
  });

  test('payment_intent.succeeded with no org/invoice/client metadata is logged and skipped, not thrown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const paymentIntentId = `pi_test_no_metadata_${randomUUID()}`;

    const payload = buildPaymentIntentSucceededPayload({
      eventId: `evt_test_${randomUUID()}`,
      paymentIntentId,
      amountReceived: 1_000,
    });

    await expect(handleStripeConnectWebhookEvent(payload, signPayload(payload))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Stripe Connect webhook: payment_intent.succeeded missing expected org/invoice/client metadata',
      expect.objectContaining({ paymentIntentId })
    );

    const { data, error } = await main.from('payments').select('id').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
    if (error) {
      throw new Error(`failed to check for an unexpected payments row: ${error.message}`);
    }
    expect(data).toBeNull();
  });

  test('charge.refunded reverses the payment via reverse_online_payment_from_webhook, with reversed_by left NULL, and is idempotent', async () => {
    const { clientId, invoiceId } = await createIssuedInvoiceFixture(100_000);
    const paymentIntentId = `pi_test_${randomUUID()}`;

    const succeededPayload = buildPaymentIntentSucceededPayload({
      eventId: `evt_test_${randomUUID()}`,
      paymentIntentId,
      amountReceived: 25_000,
      metadata: { org_id: ORG_A_ID, invoice_id: invoiceId, client_id: clientId },
    });
    await handleStripeConnectWebhookEvent(succeededPayload, signPayload(succeededPayload));

    const refundedPayload = buildChargeRefundedPayload({
      eventId: `evt_test_${randomUUID()}`,
      chargeId: `ch_test_${randomUUID()}`,
      paymentIntentId,
    });
    await handleStripeConnectWebhookEvent(refundedPayload, signPayload(refundedPayload));

    const reversed = await fetchPaymentByIntentId(paymentIntentId);
    expect(reversed.status).toBe('reversed');
    expect(reversed.reversed_by).toBeNull();
    expect(reversed.reversed_at).not.toBeNull();

    // Redelivery / Dashboard-issued-refund-confirmed-twice case: must stay
    // 'reversed', not error and not attempt a second reversal.
    await handleStripeConnectWebhookEvent(refundedPayload, signPayload(refundedPayload));
    const stillReversed = await fetchPaymentByIntentId(paymentIntentId);
    expect(stillReversed.status).toBe('reversed');
  });

  test('charge.refunded for an unrecognized payment_intent is logged and skipped, not thrown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const paymentIntentId = `pi_test_unrecognized_${randomUUID()}`;

    const payload = buildChargeRefundedPayload({
      eventId: `evt_test_${randomUUID()}`,
      chargeId: `ch_test_${randomUUID()}`,
      paymentIntentId,
    });

    await expect(handleStripeConnectWebhookEvent(payload, signPayload(payload))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Stripe Connect webhook: reverse_online_payment_from_webhook RPC failed',
      expect.objectContaining({ paymentIntentId })
    );
  });

  test('an irrelevant event type (not in RELEVANT_EVENT_TYPES) is a no-op', async () => {
    const payload = JSON.stringify({
      id: `evt_test_${randomUUID()}`,
      object: 'event',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `cus_test_${randomUUID()}`, object: 'customer' } },
    });

    await expect(handleStripeConnectWebhookEvent(payload, signPayload(payload))).resolves.toBeUndefined();
  });
});
