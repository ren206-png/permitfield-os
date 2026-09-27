import { getResendClient } from './client';
import type { RenderedEmail } from './templates/types';

// Gate 4 (Quotes & Payments), Phase A -- the one send path every template
// in lib/email/templates/ funnels through.
//
// Never throws: a failed notification must never break the primary
// business transaction it is describing, same philosophy as
// lib/audit/log.ts's writeAuditLog() (see that file's own header comment)
// -- every failure mode (missing config, SDK-reported error, SDK throw)
// is caught here and returned as a typed `{ success: false, error }`
// result instead. Callers (lib/inngest/functions/reminders.ts) decide what
// a failure means for their own call site -- this function does not
// decide it for them by throwing.
export type SendEmailResult = { success: true; id: string | null } | { success: false; error: string };

export async function sendEmail(email: RenderedEmail): Promise<SendEmailResult> {
  const fromAddress = process.env.PERMITFIELD_RESEND_FROM_ADDRESS;
  if (!fromAddress) {
    return { success: false, error: 'PERMITFIELD_RESEND_FROM_ADDRESS is not configured.' };
  }

  let client;
  try {
    client = getResendClient();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { data, error } = await client.emails.send({
      from: formatFromHeader(fromAddress, email.fromName),
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      ...(email.cc ? { cc: email.cc } : {}),
      ...(email.attachments?.length ? { attachments: email.attachments } : {}),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id ?? null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// PERMITFIELD_RESEND_FROM_ADDRESS may be a bare address or already
// "Name <address>"; either way only the address is kept when a display name
// is supplied. The name is stripped of characters that could break out of
// the header (quotes, angle brackets, line breaks).
export function formatFromHeader(fromAddress: string, fromName?: string): string {
  if (!fromName) {
    return fromAddress;
  }
  const address = /<([^>]+)>/.exec(fromAddress)?.[1] ?? fromAddress.trim();
  const name = fromName.replace(/["<>\r\n]/g, '').replace(/\s+/g, ' ').trim();
  return name ? `"${name}" <${address}>` : address;
}
