import { Resend } from 'resend';

// Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS, see
// lib/flags.ts's isFailureNotificationsEnabled() header comment). The only
// module in this repo permitted to import the `resend` package or read
// RESEND_API_KEY -- enforced by eslint.config.mjs's resendClientRestriction,
// same shape and mechanism as stripeClientRestriction/geminiClientRestriction
// in that same file. Only lib/inngest/functions/notify-on-failure.ts (a
// trusted background worker, never a route handler acting on behalf of an
// end user) may import this module's sendFailureEmail().
//
// Lazily constructed (not a module-level `new Resend(...)` at import time)
// for the same reason lib/billing/subscriptions.ts lazily constructs its
// Stripe client: importing this module must not throw in an environment
// where RESEND_API_KEY is unset and the flag above is off (e.g. `next
// build`, or any test file that imports notify-on-failure.ts without ever
// calling sendFailureEmail()) -- the key is only read, and can only throw,
// at the moment an email is actually about to be sent.
let client: Resend | null = null;
function getClient(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }
  client = new Resend(apiKey);
  return client;
}

export interface SendFailureEmailInput {
  to: string[];
  subject: string;
  text: string;
}

// Non-throwing, same `{ data, error }` shape as lib/audit/log.ts's
// writeAuditLog() and lib/notifications/write.ts's writeNotification() --
// a failed email send must not be allowed to take down the Inngest run that
// was describing it, nor prevent the in-app notification row (this
// function's sibling write) from having already been persisted. Callers
// decide what to do with a non-null `error`; this helper does not decide it
// for them by throwing. An empty `to` array is a no-op success (not an
// error) -- notify-on-failure.ts's own recipient-lookup can legitimately
// return zero addresses (e.g. an org with no member in the notified role
// set yet), and that is a real, expected state, not a delivery failure.
export async function sendFailureEmail(
  input: SendFailureEmailInput
): Promise<{ data: { id: string } | null; error: string | null }> {
  if (input.to.length === 0) {
    return { data: null, error: null };
  }

  try {
    const resend = getClient();
    // RESEND_FROM_ADDRESS must be a sender verified against a domain
    // configured in the Resend dashboard -- see .env.example's own comment.
    // Falls back to Resend's shared onboarding@resend.dev sender (works
    // unverified, but only ever delivers to the Resend account owner's own
    // inbox) so a misconfigured environment fails loudly via Resend's own
    // delivery error rather than this module inventing a fake default
    // domain that looks configured but silently can't deliver anywhere.
    const from = process.env.RESEND_FROM_ADDRESS ?? 'onboarding@resend.dev';
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) {
      return { data: null, error: error.message };
    }
    if (!data) {
      return { data: null, error: 'Resend returned no data for a non-error send.' };
    }
    return { data: { id: data.id }, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
