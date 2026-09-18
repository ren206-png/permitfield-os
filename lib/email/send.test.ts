import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks the `resend` package itself (no other test file in this repo mocks
// a third-party SDK at time of writing -- lib/quotes-payments/test-fakes.ts's
// own header comment confirms no Supabase-mocking convention exists either,
// and grepping for `vi.mock` repo-wide turns up nothing to follow, so this
// is a fresh, minimal double scoped to exactly what sendEmail() calls:
// `new Resend(key).emails.send(...)`).
const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

// Static import is safe here (rather than needing a dynamic import per
// test) precisely because sendEmail() reads process.env lazily, at call
// time -- not at module-load time -- so mutating env vars in beforeEach
// below always takes effect on the next call.
import { sendEmail } from './send';

describe('sendEmail', () => {
  const ORIGINAL_ENV = { ...process.env };
  const email = {
    to: 'client@example.com',
    subject: 'Test subject',
    text: 'Test body',
    html: '<p>Test body</p>',
  };

  beforeEach(() => {
    sendMock.mockReset();
    process.env.PERMITFIELD_RESEND_API_KEY = 'test-api-key';
    process.env.PERMITFIELD_RESEND_FROM_ADDRESS = 'notifications@permitfieldos.com';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns a non-throwing failure when PERMITFIELD_RESEND_API_KEY is unset', async () => {
    delete process.env.PERMITFIELD_RESEND_API_KEY;
    const result = await sendEmail(email);

    expect(result).toEqual({
      success: false,
      error: 'PERMITFIELD_RESEND_API_KEY is not configured; cannot send email.',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns a non-throwing failure when PERMITFIELD_RESEND_FROM_ADDRESS is unset', async () => {
    delete process.env.PERMITFIELD_RESEND_FROM_ADDRESS;
    const result = await sendEmail(email);

    expect(result).toEqual({
      success: false,
      error: 'PERMITFIELD_RESEND_FROM_ADDRESS is not configured.',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns success with the Resend message id on a successful send', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg-123' }, error: null });
    const result = await sendEmail(email);

    expect(result).toEqual({ success: true, id: 'msg-123' });
    expect(sendMock).toHaveBeenCalledWith({
      from: 'notifications@permitfieldos.com',
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  });

  it('returns a non-throwing failure when the SDK reports an error response', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Invalid recipient', name: 'validation_error' } });
    const result = await sendEmail(email);

    expect(result).toEqual({ success: false, error: 'Invalid recipient' });
  });

  it('returns a non-throwing failure when the SDK throws', async () => {
    sendMock.mockRejectedValue(new Error('network down'));
    const result = await sendEmail(email);

    expect(result).toEqual({ success: false, error: 'network down' });
  });
});
