import { describe, it, expect } from 'vitest';
import { renderEstimateSentEmail } from './estimate-sent';

describe('renderEstimateSentEmail', () => {
  const baseInput = {
    recipientEmail: 'client@example.com',
    organizationName: 'Acme Permits Inc.',
    viewUrl: 'https://www.permitfieldos.com/e/abc123',
  };

  it('addresses the recipient by name and includes the view link', () => {
    const email = renderEstimateSentEmail({ ...baseInput, recipientName: 'Jordan' });

    expect(email.to).toBe('client@example.com');
    expect(email.subject).toBe('Acme Permits Inc. sent you an estimate');
    expect(email.text).toContain('Hi Jordan,');
    expect(email.text).toContain(baseInput.viewUrl);
    expect(email.html).toContain('Hi Jordan,');
    expect(email.html).toContain(`href="${baseInput.viewUrl}"`);
  });

  it('falls back to a generic greeting when no recipient name is given', () => {
    const email = renderEstimateSentEmail(baseInput);

    expect(email.text).toContain('Hi there,');
    expect(email.html).toContain('Hi there,');
  });

  it('escapes HTML-significant characters in the organization name', () => {
    const email = renderEstimateSentEmail({ ...baseInput, organizationName: 'A & B <Contracting>' });

    expect(email.html).toContain('A &amp; B &lt;Contracting&gt;');
    expect(email.html).not.toContain('<Contracting>');
  });
});
