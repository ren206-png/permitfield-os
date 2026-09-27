import { describe, it, expect } from 'vitest';
import { renderPermitSignatureRequestEmail } from './permit-signature-request';

describe('renderPermitSignatureRequestEmail()', () => {
  const input = {
    recipientEmail: 'jordan@example.test',
    recipientName: 'Jordan <Rivera>',
    organizationName: 'Acme Electric',
    requesterEmail: 'office@acme.example',
    permitTypeTitle: 'Commercial Tenant Improvement',
    authorityName: 'City of Vancouver',
    projectAddress: '100 Main St, Vancouver, BC',
    signUrl: 'https://permitfieldos.com/sign/abc123',
    expiresAt: '2026-10-10T12:00:00Z',
  };

  it('addresses the signer, links to the signing page, and routes replies to the requester', () => {
    const email = renderPermitSignatureRequestEmail(input);
    expect(email.to).toBe('jordan@example.test');
    expect(email.replyTo).toBe('office@acme.example');
    expect(email.fromName).toBe('Acme Electric');
    expect(email.subject).toBe('Please sign: Commercial Tenant Improvement for 100 Main St, Vancouver, BC');
    expect(email.text).toContain('https://permitfieldos.com/sign/abc123');
    expect(email.html).toContain('href="https://permitfieldos.com/sign/abc123"');
  });

  it('escapes names in the HTML body', () => {
    const email = renderPermitSignatureRequestEmail(input);
    expect(email.html).toContain('Jordan &lt;Rivera&gt;');
    expect(email.html).not.toContain('<Rivera>');
  });

  it('omits reply-to when the requester has no email', () => {
    expect(renderPermitSignatureRequestEmail({ ...input, requesterEmail: null }).replyTo).toBeUndefined();
  });
});
