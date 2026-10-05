// Builds the email that files one permit filing with its authority. Pure:
// every input is already resolved, so the exact wording, subject format and
// escaping are unit-tested.
//
// Shape follows the strictest published requirement we file against --
// Richmond's PL-59 (rev. Mar 10, 2026): subject "<Property Address>,
// <Building Permit Type>", the completed application form attached, and a
// file-sharing link for drawings/documents rather than attachments. An
// authority that refuses links (Surrey's Digital Submission Guide: "downloadable
// links ... are not accepted") gets every document attached instead, listed in
// the body, and one that asks for it gets the method of payment.

export interface SubmissionDocumentLink {
  name: string;
  url: string;
}

export interface SubmissionEmailInput {
  authorityName: string;
  orgName: string;
  projectAddress: string;
  permitTypeTitle: string;
  contractorCompanyName: string | null;
  contactEmail: string;
  documentLinks: SubmissionDocumentLink[];
  linksExpireAt: Date;
  /** Filenames of documents attached alongside the form (attachments-only authorities). */
  attachedDocumentNames?: string[];
  paymentMethod?: string | null;
}

export interface SubmissionEmailContent {
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Filenames must survive every mail client and OS: drop path separators and
// characters Windows forbids, collapse whitespace, cap the length.
export function safeAttachmentFilename(base: string): string {
  const cleaned = base
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${cleaned || 'Application Form'}.pdf`;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function applicationFormFilename(projectAddress: string): string {
  return safeAttachmentFilename(`${oneLine(projectAddress)} Application Form`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildSubmissionEmail(input: SubmissionEmailInput): SubmissionEmailContent {
  const address = oneLine(input.projectAddress);
  const permitType = oneLine(input.permitTypeTitle);
  const subject = `${address}, ${permitType}`;
  const attachmentFilename = applicationFormFilename(address);
  const expires = formatDate(input.linksExpireAt);
  const applicant = input.contractorCompanyName ? `${input.contractorCompanyName} (${input.orgName})` : input.orgName;

  const attached = input.attachedDocumentNames ?? [];
  const paymentMethod = input.paymentMethod ? oneLine(input.paymentMethod) : null;

  const textLines = [
    `Hello ${input.authorityName},`,
    '',
    `Please find attached the completed application form for ${permitType} at ${address}.`,
    '',
    `Project address: ${address}`,
    `Type of application: ${permitType}`,
    ...(paymentMethod ? [`Method of payment: ${paymentMethod}`] : []),
    `Applicant: ${applicant}`,
    `Contact: ${input.contactEmail} (replies to this email go directly to the applicant)`,
    '',
  ];
  if (attached.length > 0) {
    textLines.push('Also attached:');
    for (const name of attached) {
      textLines.push(`- ${name}`);
    }
  } else if (input.documentLinks.length > 0) {
    textLines.push(`Supporting drawings and documents (download links valid until ${expires}):`);
    for (const doc of input.documentLinks) {
      textLines.push(`- ${doc.name}: ${doc.url}`);
    }
  } else {
    textLines.push('No supporting drawings or documents are included with this submission.');
  }
  textLines.push('', 'Thank you,', applicant, '', 'Sent on the applicant’s behalf via PermitField OS.');

  const docsHtml =
    attached.length > 0
      ? `<p>Also attached:</p><ul>${attached.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
      : input.documentLinks.length > 0
      ? `<p>Supporting drawings and documents (download links valid until ${escapeHtml(expires)}):</p><ul>${input.documentLinks
          .map((doc) => `<li><a href="${escapeHtml(doc.url)}">${escapeHtml(doc.name)}</a></li>`)
          .join('')}</ul>`
      : '<p>No supporting drawings or documents are included with this submission.</p>';

  const html = [
    `<p>Hello ${escapeHtml(input.authorityName)},</p>`,
    `<p>Please find attached the completed application form for <strong>${escapeHtml(permitType)}</strong> at <strong>${escapeHtml(address)}</strong>.</p>`,
    `<p>Project address: ${escapeHtml(address)}<br>Type of application: ${escapeHtml(permitType)}<br>${
      paymentMethod ? `Method of payment: ${escapeHtml(paymentMethod)}<br>` : ''
    }Applicant: ${escapeHtml(applicant)}<br>Contact: <a href="mailto:${escapeHtml(input.contactEmail)}">${escapeHtml(input.contactEmail)}</a> (replies to this email go directly to the applicant)</p>`,
    docsHtml,
    `<p>Thank you,<br>${escapeHtml(applicant)}</p>`,
    '<p style="color:#6b7280;font-size:12px">Sent on the applicant’s behalf via PermitField OS.</p>',
  ].join('');

  return { subject, text: textLines.join('\n'), html, attachmentFilename };
}
