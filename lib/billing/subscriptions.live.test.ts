// Run via `npm run test:live` (vitest.live.config.mts) -- see
// lib/bridge/client-portal.live.test.ts's header for the two-stack setup
// this repo's live tests share. This file only touches project 1 (the main
// app's Supabase project); it has no CLIENT_PORTAL_SUPABASE_* dependency.
//
// Health-check audit follow-up: covers the two bug fixes made to
// handleStripeWebhookEvent()/upsertOrgSubscription() in
// lib/billing/subscriptions.ts --
//   1. invoice.payment_failed previously cast event.data.object to
//      Stripe.Subscription (it's actually a Stripe.Invoice), so
//      orgId/subscriptionId silently resolved to undefined in the log line.
//      Fixed to read invoice.parent.subscription_details.metadata/subscription
//      instead. Proven here via a console.error spy on a real, signature-
//      verified event. This branch never touches the DB, so it needs no real
//      org at all -- a random UUID stands in for orgId.
//   2. upsertOrgSubscription() previously upserted unconditionally on every
//      customer.subscription.* event keyed only by org_id -- since Stripe's
//      delivery is at-least-once but NOT ordered, an older, out-of-order
//      event could overwrite a newer one's state. Fixed by comparing the
//      incoming event's own `.created` against the stored row's
//      stripe_event_created_at (migration 42) before writing. Proven here by
//      sending a newer event first, then a stale/older one, and asserting
//      the stale one is skipped, not applied.
//
// Deliberately does NOT cover the checkout.session.completed branch: that
// branch calls stripe.subscriptions.retrieve(subscriptionId), a real network
// call to Stripe's live API that needs real account credentials -- out of
// scope for a local/CI live-DB test. Both branches covered here
// (invoice.payment_failed, customer.subscription.updated/.deleted) touch
// only local Postgres and locally-computed webhook-signature crypto, no
// live Stripe network call.
//
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET: handleStripeWebhookEvent() reads
// both directly from process.env, and getStripeClient() only ever uses the
// key to construct a Stripe SDK instance -- never a network call for either
// branch under test here (stripe.webhooks.constructEvent/
// generateTestHeaderString are pure local HMAC computations). A fake
// sk_test_.../whsec_... value is therefore sufficient; no real Stripe
// account is needed, unlike lib/bridge/client-portal.live.test.ts's real
// Storage upload. Set directly on process.env below (not .env.local) so
// this file is self-contained and doesn't depend on a developer's real
// Stripe test-mode keys being present locally or in CI step env.
process.env.STRIPE_SECRET_KEY ??= 'sk_test_stripe_client_lives_here_only_51H0';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test_subscriptions_live_test_secret';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/service-client';
import { handleStripeWebhookEvent } from './subscriptions';

// supabase/seed.sql PART 2 fixture (LOCAL DEV / TEST FIXTURES ONLY) -- the
// same Org A identity lib/audit/log.live.test.ts and
// lib/bridge/client-portal.live.test.ts already rely on. Used here (rather
// than inserting a fresh synthetic org) because service_role is only ever
// granted SELECT on `organizations` (20260806000032's own grant, needed for
// the client-portal bridge's read path) -- there is no INSERT grant for
// service_role to create a new org fixture with, and org_subscriptions.org_id
// has a not-null FK to organizations(id), so a real, already-existing org is
// required. org_subscriptions has no DELETE grant for service_role either
// (20260806000040 grants only select/insert/update), so the row this test
// upserts into Org A's org_subscriptions is left in place across reruns --
// same "accumulation across reruns is expected and harmless on a throwaway
// local/CI stack" reasoning lib/audit/log.live.test.ts's own header gives,
// `supabase db reset` clears it. This is safe to assert against without a
// known starting state: every event.created timestamp this file sends is
// derived from Date.now() at run time, which is always strictly greater than
// whatever an earlier run left behind, so the out-of-order guard's own
// ">=" comparison never accidentally treats this run's "newer" event as
// stale relative to a prior run's leftover row.
const ORG_A_ID = '20000000-0000-0000-0000-00000000000a';

const main = createServiceClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function fetchOrgSubscription(orgId: string) {
  const { data, error } = await main.from('org_subscriptions').select('*').eq('org_id', orgId).single();
  if (error || !data) {
    throw new Error(`failed to read back org_subscriptions row for org ${orgId}: ${error?.message}`);
  }
  return data;
}

// Signs `payload` exactly as a real Stripe webhook delivery would, using the
// SDK's own test-signature helper (stripe.webhooks.generateTestHeaderString)
// -- a pure local HMAC computation, no network call -- so
// handleStripeWebhookEvent()'s real stripe.webhooks.constructEvent()
// signature-verification path is genuinely exercised here, not bypassed.
function signPayload(payload: string): string {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
}

// Minimal-but-real-shaped Stripe.Subscription event payload for
// customer.subscription.updated/.deleted -- only the fields
// handleStripeWebhookEvent()/upsertOrgSubscription() actually read.
function buildSubscriptionEventPayload(opts: {
  eventId: string;
  eventType: 'customer.subscription.updated' | 'customer.subscription.deleted';
  eventCreated: number;
  orgId: string;
  tier: string;
  status: string;
  subscriptionId: string;
  customerId: string;
  currentPeriodEnd: number;
  trialEnd: number | null;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: opts.eventType,
    created: opts.eventCreated,
    data: {
      object: {
        id: opts.subscriptionId,
        object: 'subscription',
        customer: opts.customerId,
        status: opts.status,
        metadata: { org_id: opts.orgId, tier: opts.tier },
        items: { data: [{ current_period_end: opts.currentPeriodEnd }] },
        trial_end: opts.trialEnd,
      },
    },
  });
}

// Minimal-but-real-shaped Stripe.Invoice event payload for
// invoice.payment_failed -- the exact shape the earlier bug fix now reads
// from (invoice.parent.subscription_details.*), not the old, wrong
// Stripe.Subscription cast.
function buildInvoicePaymentFailedPayload(opts: {
  eventId: string;
  eventCreated: number;
  invoiceId: string;
  orgId: string;
  subscriptionId: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: 'invoice.payment_failed',
    created: opts.eventCreated,
    data: {
      object: {
        id: opts.invoiceId,
        object: 'invoice',
        parent: {
          type: 'subscription_details',
          subscription_details: {
            metadata: { org_id: opts.orgId },
            subscription: opts.subscriptionId,
          },
        },
      },
    },
  });
}

describe('handleStripeWebhookEvent (live)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('invoice.payment_failed logs the real orgId/subscriptionId, not undefined (type-cast fix)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const orgId = randomUUID();
    const subscriptionId = `sub_test_${randomUUID()}`;
    const invoiceId = `in_test_${randomUUID()}`;
    const eventCreated = Math.floor(Date.now() / 1000);

    const payload = buildInvoicePaymentFailedPayload({
      eventId: `evt_test_${randomUUID()}`,
      eventCreated,
      invoiceId,
      orgId,
      subscriptionId,
    });

    await handleStripeWebhookEvent(payload, signPayload(payload));

    expect(errorSpy).toHaveBeenCalledWith('Stripe webhook: invoice.payment_failed', {
      orgId,
      subscriptionId,
      invoiceId,
    });
  });

  test('a newer customer.subscription.updated event is applied, then an older/stale redelivery is skipped', async () => {
    const subscriptionId = `sub_test_${randomUUID()}`;
    const customerId = `cus_test_${randomUUID()}`;
    const baseCreated = Math.floor(Date.now() / 1000);

    // First, a genuinely newer event (Date.now()-derived, so always newer
    // than anything a previous run of this file left behind on Org A's row
    // -- see this file's ORG_A_ID comment above).
    const newerPayload = buildSubscriptionEventPayload({
      eventId: `evt_test_${randomUUID()}`,
      eventType: 'customer.subscription.updated',
      eventCreated: baseCreated,
      orgId: ORG_A_ID,
      tier: 'starter',
      status: 'active',
      subscriptionId,
      customerId,
      currentPeriodEnd: baseCreated + 30 * 24 * 60 * 60,
      trialEnd: null,
    });
    await handleStripeWebhookEvent(newerPayload, signPayload(newerPayload));

    const afterNewer = await fetchOrgSubscription(ORG_A_ID);
    expect(afterNewer.tier).toBe('starter');
    expect(afterNewer.status).toBe('active');
    expect(afterNewer.stripe_subscription_id).toBe(subscriptionId);

    // Then, a stale/out-of-order redelivery with an OLDER event.created and
    // different (wrong, if applied) tier/status -- must be skipped entirely,
    // leaving the row exactly as the newer event above left it.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stalePayload = buildSubscriptionEventPayload({
      eventId: `evt_test_${randomUUID()}`,
      eventType: 'customer.subscription.updated',
      eventCreated: baseCreated - 3600,
      orgId: ORG_A_ID,
      tier: 'enterprise',
      status: 'past_due',
      subscriptionId,
      customerId,
      currentPeriodEnd: baseCreated + 30 * 24 * 60 * 60,
      trialEnd: null,
    });
    await handleStripeWebhookEvent(stalePayload, signPayload(stalePayload));

    const afterStale = await fetchOrgSubscription(ORG_A_ID);
    expect(afterStale.tier).toBe('starter');
    expect(afterStale.status).toBe('active');
    expect(errorSpy).toHaveBeenCalledWith(
      'Stripe webhook: skipping stale/out-of-order event for org_subscriptions',
      expect.objectContaining({ orgId: ORG_A_ID })
    );
  });
});
