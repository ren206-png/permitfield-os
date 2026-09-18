import { Resend } from 'resend';

// Gate 4 (Quotes & Payments), Phase A -- Resend client construction.
// Lazy (constructed only when actually sending, inside
// lib/email/send.ts's sendEmail()), never at module load -- same "fail at
// the point of use, not at import time" discipline as
// lib/billing/subscriptions.ts's getStripeClient() and
// lib/supabase/service-client.ts's createServiceClient(), so importing
// this module (or anything that imports it) never throws in an
// environment that hasn't configured PERMITFIELD_RESEND_API_KEY yet.
//
// No existing reserved env-var name for an email provider key exists
// anywhere in this repo (confirmed by grep across .ts/.tsx/.json/.example
// before writing this) -- PERMITFIELD_RESEND_API_KEY follows this repo's
// established PERMITFIELD_<PROVIDER-or-CONCERN>_<FIELD> naming convention
// (e.g. PERMITFIELD_FF_QUOTES_PAYMENTS, PERMITFIELD_JURISDICTION_DATA_STRATEGY).
export function getResendClient(): Resend {
  const apiKey = process.env.PERMITFIELD_RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('PERMITFIELD_RESEND_API_KEY is not configured; cannot send email.');
  }
  return new Resend(apiKey);
}
