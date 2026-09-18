// Gate 4 (Quotes & Payments) reminders -- shared shape every template in
// this directory renders into. Deliberately plain (recipient/subject/
// text/html only, no attachments/cc/bcc) -- nothing in this pass needs
// more than that, and lib/email/send.ts's sendEmail() takes exactly this
// shape so a template and the sender never need to agree on anything else.
export interface RenderedEmail {
  to: string;
  subject: string;
  /** Always populated (never derived from html) -- Resend, and any mail
   * client that prefers text/plain, gets a real plain-text body. */
  text: string;
  html: string;
}
