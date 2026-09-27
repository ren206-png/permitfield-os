// Gate 4 (Quotes & Payments) reminders -- shared shape every template in
// this directory renders into, and that lib/email/send.ts's sendEmail()
// takes. The optional fields exist for authority submissions
// (lib/submissions/), which attach the filled form and route replies back
// to the contractor; reminder templates leave them unset.
export interface RenderedEmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  /** Always populated (never derived from html) -- Resend, and any mail
   * client that prefers text/plain, gets a real plain-text body. */
  text: string;
  html: string;
  /** Display name for the From header; the address itself is always PERMITFIELD_RESEND_FROM_ADDRESS. */
  fromName?: string;
  replyTo?: string;
  cc?: string;
  attachments?: RenderedEmailAttachment[];
}
