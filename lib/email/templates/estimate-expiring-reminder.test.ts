import { describe, it, expect } from 'vitest';
import { renderEstimateExpiringReminderEmail } from './estimate-expiring-reminder';

describe('renderEstimateExpiringReminderEmail', () => {
  const baseInput = {
    recipientEmail: 'client@example.com',
    recipientName: 'Jordan',
    organizationName: 'Acme Permits Inc.',
    viewUrl: 'https://www.permitfieldos.com/estimate/abc123_-XYZ',
    expiresOnDisplay: '2026-10-15',
  };

  it('names the expiry date in the subject and body when one is given', () => {
    const email = renderEstimateExpiringReminderEmail(baseInput);

    expect(email.to).toBe('client@example.com');
    expect(email.subject).toBe('Reminder: your estimate from Acme Permits Inc. expires on 2026-10-15');
    expect(email.text).toContain('Hi Jordan,');
    expect(email.text).toContain('the estimate Acme Permits Inc. sent you expires on 2026-10-15.');
    expect(email.text).toContain(baseInput.viewUrl);
    expect(email.html).toContain(`href="${baseInput.viewUrl}"`);
  });

  it('reads as a reminder, not a new estimate announcement', () => {
    const email = renderEstimateExpiringReminderEmail(baseInput);

    expect(email.subject).toMatch(/^Reminder:/);
    expect(email.text).not.toContain('sent you an estimate');
    expect(email.text).toContain('If you have already responded, please disregard this reminder.');
  });

  it('switches to "awaiting your response" wording when there is no upcoming expiry', () => {
    const email = renderEstimateExpiringReminderEmail({ ...baseInput, expiresOnDisplay: null });

    expect(email.subject).toBe('Reminder: your estimate from Acme Permits Inc. is awaiting your response');
    expect(email.text).toContain('is still awaiting your response.');
    expect(email.text).not.toContain('expires');
    expect(email.html).not.toContain('expires');
  });

  it('sends as the organization, with no Reply-To', () => {
    const email = renderEstimateExpiringReminderEmail(baseInput);

    expect(email.fromName).toBe('Acme Permits Inc.');
    expect(email.replyTo).toBeUndefined();
  });

  it('falls back to a generic greeting when no recipient name is given', () => {
    const email = renderEstimateExpiringReminderEmail({ ...baseInput, recipientName: null });

    expect(email.text).toContain('Hi there,');
    expect(email.html).toContain('Hi there,');
  });

  it('escapes HTML-significant characters in the organization name', () => {
    const email = renderEstimateExpiringReminderEmail({ ...baseInput, organizationName: 'A & B <Contracting>' });

    expect(email.html).toContain('A &amp; B &lt;Contracting&gt;');
    expect(email.html).not.toContain('<Contracting>');
  });
});
