import { beforeEach, describe, expect, it, vi } from 'vitest';

const { refundsCreate, reversePayment } = vi.hoisted(() => ({ refundsCreate: vi.fn(), reversePayment: vi.fn() }));

vi.mock('stripe', () => ({
  default: class {
    refunds = { create: refundsCreate };
  },
}));
vi.mock('@/lib/entitlements', () => ({ can: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/service-client', () => ({ createServiceClient: vi.fn() }));
vi.mock('./payments', () => ({ reversePayment }));

import { refundOnlinePayment } from './stripe-connect';

const PARAMS = { orgId: 'org-1', paymentId: 'pay-1', actorUserId: 'user-1', actorRole: 'org_owner' as const };

function supabaseReturning(row: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => chain } as never;
}

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS_ONLINE = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  refundsCreate.mockReset();
  reversePayment.mockReset().mockResolvedValue({ id: 'pay-1', status: 'reversed' });
});

describe('refundOnlinePayment()', () => {
  it('refunds through Stripe with an idempotency key, then reverses the ledger', async () => {
    const supabase = supabaseReturning({ id: 'pay-1', org_id: 'org-1', method: 'card', status: 'recorded', stripe_payment_intent_id: 'pi_1' });
    await refundOnlinePayment(supabase, PARAMS);
    expect(refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1' }, { idempotencyKey: 'permitfield-refund-pay-1' });
    expect(reversePayment).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.invocationCallOrder[0]).toBeLessThan(reversePayment.mock.invocationCallOrder[0]);
  });

  it('refuses a manual (non-card) payment without touching Stripe', async () => {
    const supabase = supabaseReturning({ id: 'pay-1', org_id: 'org-1', method: 'cheque', status: 'recorded', stripe_payment_intent_id: null });
    await expect(refundOnlinePayment(supabase, PARAMS)).rejects.toThrow(/not an online/);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('refuses an already-reversed payment', async () => {
    const supabase = supabaseReturning({ id: 'pay-1', org_id: 'org-1', method: 'card', status: 'reversed', stripe_payment_intent_id: 'pi_1' });
    await expect(refundOnlinePayment(supabase, PARAMS)).rejects.toThrow(/not in "recorded"/);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('does not reverse the ledger when Stripe fails', async () => {
    refundsCreate.mockRejectedValue(new Error('stripe down'));
    const supabase = supabaseReturning({ id: 'pay-1', org_id: 'org-1', method: 'card', status: 'recorded', stripe_payment_intent_id: 'pi_1' });
    await expect(refundOnlinePayment(supabase, PARAMS)).rejects.toThrow('stripe down');
    expect(reversePayment).not.toHaveBeenCalled();
  });
});
