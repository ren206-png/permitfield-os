import { describe, it, expect } from 'vitest';
import { renderInvoiceDueReminderEmail } from './invoice-due-reminder';

describe('renderInvoiceDueReminderEmail', () => {
  const baseInput = {
    recipientEmail: 'client@example.com',
    recipientName: 'Jordan',
    organizationName: 'Acme Permits Inc.',
    viewUrl: 'https://www.permitfieldos.com/i/xyz789',
    invoiceNumber: 42,
    dueDateDisplay: 'September 20, 2026',
  };

  it('renders a "due soon" subject and body when overdue is false', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, overdue: false });

    expect(email.subject).toBe('Reminder: invoice #42 from Acme Permits Inc. is due soon');
    expect(email.text).toContain('is due on September 20, 2026');
    expect(email.text).not.toContain('overdue');
    expect(email.html).toContain(`href="${baseInput.viewUrl}"`);
  });

  it('renders an "overdue" subject and body when overdue is true', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, overdue: true });

    expect(email.subject).toBe('Overdue: invoice #42 from Acme Permits Inc.');
    expect(email.text).toContain('was due on September 20, 2026 and is now overdue.');
  });

  it('falls back to a generic invoice label when no invoice number is given', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, invoiceNumber: null, overdue: false });

    expect(email.subject).toBe('Reminder: your invoice from Acme Permits Inc. is due soon');
    expect(email.text).toContain('your invoice from Acme Permits Inc. is due on');
  });

  it('sends as the organization and routes replies to its contact email', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, overdue: false, replyToEmail: 'office@acme.example' });

    expect(email.fromName).toBe('Acme Permits Inc.');
    expect(email.replyTo).toBe('office@acme.example');
    expect(email.text).toContain('Questions? Reply to this email or contact Acme Permits Inc. directly.');
  });

  it('does not tell the client to reply when there is no contact email to reply to', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, overdue: false, replyToEmail: null });

    expect(email.replyTo).toBeUndefined();
    expect(email.text).toContain('Questions? Contact Acme Permits Inc. directly.');
    expect(email.text).not.toContain('Reply to this email');
    expect(email.html).not.toContain('Reply to this email');
  });

  it('falls back to a generic greeting when no recipient name is given', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, recipientName: null, overdue: false });

    expect(email.text).toContain('Hi there,');
  });
});
