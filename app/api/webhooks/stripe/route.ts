import { notFound } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { isBillingEnabled } from '@/lib/flags';
import { handleStripeWebhookEvent } from '@/lib/billing/subscriptions';

// BILLING_PROPOSAL.md §3. The one HTTP entry point Stripe itself calls --
// no end-user session, no auth cookie, no RLS involved at all (the handler
// this delegates to uses lib/supabase/service-client.ts's service-role
// client, sanctioned for exactly this "background/webhook/cron" shape --
// see that module's own header comment). Authentication here is entirely
// the Stripe signature check inside handleStripeWebhookEvent(), which is
// why the raw body must reach it unmodified.
//
// isBillingEnabled() gate first, before touching the body or Stripe at all
// -- same "flag off means 404, not merely inert" discipline every other
// flag-gated route/action in this codebase already follows (see e.g.
// app/(app)/projects/new/actions.ts's isIntakeEnabled() check). notFound()
// is valid inside a Route Handler in this Next.js version (16.3.0) -- see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
// not-found.md -- so this uses the same call every flag-gated Server
// Action in this repo already uses, rather than a hand-rolled 404
// Response.
//
// request.text() (not request.json()) is deliberate: Stripe's SDK
// recomputes the webhook HMAC over the exact bytes it sent, and
// re-serializing a parsed-then-stringified body almost never byte-matches
// -- the specific integration bug BILLING_PROPOSAL.md §3's research called
// out and lib/billing/subscriptions.ts's own header comment documents.
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    notFound();
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    await handleStripeWebhookEvent(rawBody, signature);
  } catch (error) {
    // Signature verification failures and any other error from the handler
    // land here. Returning 400 (not 500) for a bad signature tells Stripe
    // not to retry a request that will never verify; genuine transient
    // failures (e.g. a DB error inside upsertOrgSubscription) also surface
    // as 400 today since handleStripeWebhookEvent doesn't distinguish the
    // two -- Stripe's own retry schedule still re-delivers the event on its
    // usual backoff regardless of status code in the 4xx/5xx range, so this
    // is not a silent-drop risk.
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    console.error('Stripe webhook error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
