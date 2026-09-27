import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// E-signature, Stage B -- asks one person to sign a filled city permit form.
// Plain, single-link email like estimate-sent.ts; replies go to the person
// who asked, not to PermitField.
export interface PermitSignatureRequestEmailInput {
  recipientEmail: string;
  recipientName: string;
  organizationName: string;
  requesterEmail: string | null;
  permitTypeTitle: string;
  authorityName: string;
  projectAddress: string;
  signUrl: string;
  expiresAt: string;
}

export function renderPermitSignatureRequestEmail(input: PermitSignatureRequestEmailInput): RenderedEmail {
  const expires = new Date(input.expiresAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Please sign: ${input.permitTypeTitle} for ${input.projectAddress}`;
  const intro = `${input.organizationName} has prepared the ${input.permitTypeTitle} application to ${input.authorityName} for ${input.projectAddress} and needs your signature.`;
  const how = 'Open the link to review the filled form, then type or draw your signature. It takes about a minute.';

  const text = [
    `Hi ${input.recipientName},`,
    '',
    intro,
    how,
    '',
    input.signUrl,
    '',
    `This link is personal to you and expires on ${expires}. If you weren't expecting it, reply to this email.`,
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    `<p>${escapeHtml(intro)} ${escapeHtml(how)}</p>`,
    `<p><a href="${escapeHtml(input.signUrl)}">Review and sign the form</a></p>`,
    `<p>This link is personal to you and expires on ${escapeHtml(expires)}. If you weren&#39;t expecting it, reply to this email.</p>`,
  ].join('\n');

  return {
    to: input.recipientEmail,
    subject,
    text,
    html,
    fromName: input.organizationName,
    ...(input.requesterEmail ? { replyTo: input.requesterEmail } : {}),
  };
}
