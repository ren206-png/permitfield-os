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

  it('falls back to a generic greeting when no recipient name is given', () => {
    const email = renderInvoiceDueReminderEmail({ ...baseInput, recipientName: null, overdue: false });

    expect(email.text).toContain('Hi there,');
  });
});
