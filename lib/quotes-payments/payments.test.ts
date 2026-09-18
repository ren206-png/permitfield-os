import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotesPaymentsDisabledError } from './estimates';
import { recordPayment, reversePayment } from './payments';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const ACTOR = { actorUserId: 'user-1', actorRole: 'org_owner' as const };

const PAYMENT_ROW = {
  id: 'pay-1',
  org_id: ORG_ID,
  client_id: 'client-1',
  method: 'e_transfer',
  status: 'recorded',
  amount_cents: 22600,
  currency_code: 'CAD',
  reference_note: 'ETR-123',
  received_at: '2026-09-13',
  recorded_by: 'user-1',
  reversed_by: null,
  reversed_at: null,
  reversal_reason: null,
  created_at: '2026-09-13T00:00:00.000Z',
  updated_at: '2026-09-13T00:00:00.000Z',
};

describe('recordPayment()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      recordPayment(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        method: 'e_transfer',
        amountCents: 22600n,
        receivedAt: '2026-09-13',
        ...ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('calls record_payment with cents converted to plain numbers, and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient({}, { record_payment: [ok(PAYMENT_ROW)] });

    const payment = await recordPayment(supabase as never, {
      orgId: ORG_ID,
      clientId: 'client-1',
      method: 'e_transfer',
      amountCents: 22600n,
      receivedAt: '2026-09-13',
      referenceNote: 'ETR-123',
      allocations: [{ invoiceId: 'inv-1', amountCents: 22600n }],
      ...ACTOR,
    });

    expect(payment.amountCents).toBe(22600n);
    expect(payment.status).toBe('recorded');

    const rpcCall = supabase.callLog.find((c) => c.type === 'rpc' && c.name === 'record_payment');
    expect(rpcCall?.params.p_amount_cents).toBe(22600);
    expect(rpcCall?.params.p_allocations).toEqual([{ invoice_id: 'inv-1', amount_cents: 22600 }]);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a record_payment RPC error (e.g. allocation total mismatch) rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { record_payment: [dbError('invalid_transition: allocation total 100 does not equal payment amount 200')] }
    );

    await expect(
      recordPayment(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        method: 'cheque',
        amountCents: 20000n,
        receivedAt: '2026-09-13',
        allocations: [{ invoiceId: 'inv-1', amountCents: 10000n }],
        ...ACTOR,
      })
    ).rejects.toThrow(/allocation total/);
  });
});

describe('reversePayment()', () => {
  it('calls reverse_payment and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        reverse_payment: [
          ok({
            ...PAYMENT_ROW,
            status: 'reversed',
            reversed_by: 'user-1',
            reversed_at: '2026-09-14T00:00:00.000Z',
            reversal_reason: 'entered in error',
          }),
        ],
      }
    );

    const payment = await reversePayment(supabase as never, {
      orgId: ORG_ID,
      paymentId: 'pay-1',
      reversalReason: 'entered in error',
      ...ACTOR,
    });

    expect(payment.status).toBe('reversed');
    expect(payment.reversalReason).toBe('entered in error');
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a reverse_payment RPC error (e.g. payment already reversed)', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { reverse_payment: [dbError('invalid_transition: payment is not in recorded status')] }
    );

    await expect(
      reversePayment(supabase as never, { orgId: ORG_ID, paymentId: 'pay-1', ...ACTOR })
    ).rejects.toThrow(/invalid_transition/);
  });
});
