import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Team invitation. Plain, single-link email like estimate-sent.ts; replies go
// to the person who sent the invitation.
export interface OrgInvitationEmailInput {
  recipientEmail: string;
  organizationName: string;
  inviterEmail: string | null;
  roleLabel: string;
  acceptUrl: string;
}

export function renderOrgInvitationEmail(input: OrgInvitationEmailInput): RenderedEmail {
  const who = input.inviterEmail ? `${input.inviterEmail} has` : 'You have been';
  const intro = `${who} invited you to join ${input.organizationName} on PermitField as ${input.roleLabel.toLowerCase()}.`;
  const how = `Open the link and sign in, or create an account, with ${input.recipientEmail}. The invitation expires in 7 days.`;

  return {
    to: input.recipientEmail,
    subject: `Join ${input.organizationName} on PermitField`,
    text: [intro, how, '', input.acceptUrl].join('\n'),
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p>${escapeHtml(how)}</p>`,
      `<p><a href="${escapeHtml(input.acceptUrl)}">Accept the invitation</a></p>`,
    ].join('\n'),
    fromName: input.organizationName,
    ...(input.inviterEmail ? { replyTo: input.inviterEmail } : {}),
  };
}
