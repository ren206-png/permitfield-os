import { notFound } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { isQuotesPaymentsOnlineEnabled } from '@/lib/flags';
import { handleStripeConnectWebhookEvent } from '@/lib/quotes-payments/stripe-connect';

// Gate 4 (Quotes & Payments), Phase C. Mirrors app/api/webhooks/stripe/
// route.ts's own shape exactly (see that file's header comment for why
// request.text() rather than request.json() is required for signature
// verification), but is a SEPARATE endpoint with a SEPARATE secret
// (STRIPE_CONNECT_WEBHOOK_SECRET, not STRIPE_WEBHOOK_SECRET) -- flow B
// (a contractor's own customer paying via Connect) must never share a
// webhook identity with flow A (PermitField's own SaaS billing), per
// GATE_4_FINDINGS.md §2 and lib/quotes-payments/stripe-connect.ts's own
// header comment.
//
// isQuotesPaymentsOnlineEnabled() gate first, before touching the body or
// Stripe at all -- same "flag off means 404, not merely inert" discipline
// as the flow A route.
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isQuotesPaymentsOnlineEnabled()) {
    notFound();
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    await handleStripeConnectWebhookEvent(rawBody, signature);
  } catch (error) {
    // Same posture as the flow A route: signature failures and any other
    // handler error return 400 so Stripe's own retry schedule takes over
    // for a genuinely transient failure, without this route trying to
    // distinguish the two itself.
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    console.error('Stripe Connect webhook error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
