import { Resend } from 'resend';

// Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K/§F/§J.4). Resend is the
// provider Ren chose once presented with §J.4's blocker (zero notification
// infrastructure existed before this sub-phase -- confirmed by §F's
// exhaustive search). This is the ONLY module in this repo permitted to
// import the `resend` package or read RESEND_API_KEY/RESEND_FROM_EMAIL --
// see eslint.config.mjs's resendClientRestriction for the enforced import
// boundary, and .env.example's own comment for setup instructions.
//
// getResendClient() is lazily constructed -- same "fail at the point of
// use, not at import time" discipline as lib/billing/subscriptions.ts's
// getStripeClient(): importing this module (or lib/inngest/functions/
// notify.ts, which imports it) never throws in an environment lacking
// RESEND_API_KEY; only actually attempting to send an email does.

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not configured.');
  }
  return new Resend(key);
}

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error('RESEND_FROM_EMAIL is not configured.');
  }
  return from;
}

export interface SendNotificationEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendNotificationEmailResult {
  providerMessageId: string;
}

/**
 * Sends one plain-text email via Resend. Deliberately thin -- no HTML
 * templating, no batching, no retry logic of its own. Retries are already
 * covered by the caller (lib/inngest/functions/notify.ts's own
 * `retries: 2` + step.run() boundary), same "don't duplicate what the
 * caller already provides" reasoning as every lib/ai/* model adapter in
 * this codebase. Throws on any non-success response rather than
 * swallowing it, so the caller's step can decide how to record the
 * failure (see notify.ts's send-and-log step, which catches this and
 * writes a `status = 'failed'` notification_log row instead of letting
 * one bad recipient address fail every other recipient's send).
 */
export async function sendNotificationEmail(
  input: SendNotificationEmailInput
): Promise<SendNotificationEmailResult> {
  const client = getResendClient();
  const { data, error } = await client.emails.send({
    from: getFromEmail(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  if (error || !data) {
    throw new Error(`Resend send failed: ${error?.message ?? 'no data returned'}`);
  }
  return { providerMessageId: data.id };
}
