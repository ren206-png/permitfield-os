import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotesPaymentsDisabledError } from './estimates';
import {
  createDraftChangeOrder,
  issueChangeOrder,
  recordChangeOrderAcceptance,
  replaceDraftChangeOrderLineItems,
  sendChangeOrderForAcceptance,
  voidChangeOrder,
} from './change-orders';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const ACTOR = { actorUserId: 'user-1', actorRole: 'org_owner' as const };
const EXTERNAL_ACTOR = { externalActorId: 'token-1', externalActorLabel: 'jane@client.example' };

const TAX_PROFILE_ROW = {
  id: 'profile-1',
  org_id: ORG_ID,
  legal_name: 'Acme Co',
  trading_name: null,
  address_line1: '1 Main St',
  address_line2: null,
  city: 'Toronto',
  province_code: 'ON',
  postal_code: 'M1M 1M1',
  country_code: 'CA',
  invoice_contact_name: null,
  invoice_contact_email: null,
  currency_code: 'CAD',
  gst_hst_status: 'registered',
  gst_hst_number: '123456789RT0001',
  bc_pst_status: 'unregistered',
  bc_pst_number: null,
};

const DRAFT_LINE_ITEM_ROWS = [
  {
    id: 'li-1',
    description: 'Extra outlet install',
    quantity: '2',
    unit_price_cents: 15000,
    discount_percent: null,
    discount_fixed_cents: null,
  },
];

const CHANGE_ORDER_ROW = {
  id: 'co-1',
  org_id: ORG_ID,
  client_id: 'client-1',
  source_invoice_id: 'inv-1',
  status: 'draft',
  currency_code: 'CAD',
  title: 'Extra outlet',
  description: null,
  subtotal_cents: null,
  discount_total_cents: null,
  tax_total_cents: null,
  total_cents: null,
  sent_line_items: null,
  sent_subtotal_cents: null,
  sent_discount_total_cents: null,
  sent_tax_total_cents: null,
  sent_total_cents: null,
  resulting_invoice_id: null,
  voided_at: null,
  void_reason: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

describe('createDraftChangeOrder()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      createDraftChangeOrder(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        sourceInvoiceId: 'inv-1',
        title: 'Extra outlet',
        lineItems: [],
        ...ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('creates a draft change order + line items and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient({
      change_orders: [ok(CHANGE_ORDER_ROW)],
      change_order_line_items: [ok(null)],
    });

    const result = await createDraftChangeOrder(supabase as never, {
      orgId: ORG_ID,
      clientId: 'client-1',
      sourceInvoiceId: 'inv-1',
      title: 'Extra outlet',
      lineItems: [{ description: 'Extra outlet install', quantity: '2', unitPriceCents: 15000n }],
      ...ACTOR,
    });

    expect(result.id).toBe('co-1');
    expect(result.status).toBe('draft');
    expect(result.sourceInvoiceId).toBe('inv-1');
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a real insert error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({ change_orders: [dbError('connection reset')] });
    await expect(
      createDraftChangeOrder(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        sourceInvoiceId: 'inv-1',
        title: 'Extra outlet',
        lineItems: [],
        ...ACTOR,
      })
    ).rejects.toThrow(/connection reset/);
  });
});

describe('replaceDraftChangeOrderLineItems()', () => {
  it('deletes existing line items then inserts the replacement set', async () => {
    const supabase = new FakeSupabaseClient({
      change_order_line_items: [
        ok(null),
        ok([
          {
            id: 'li-2',
            description: 'New line',
            quantity: '1',
            unit_price_cents: 5000,
            discount_percent: null,
            discount_fixed_cents: null,
            position: 0,
          },
        ]),
      ],
    });

    const result = await replaceDraftChangeOrderLineItems(supabase as never, {
      orgId: ORG_ID,
      changeOrderId: 'co-1',
      lineItems: [{ description: 'New line', quantity: '1', unitPriceCents: 5000n }],
      ...ACTOR,
    });

    expect(result).toHaveLength(1);
    expect(result[0].unitPriceCents).toBe(5000n);
  });
});

describe('sendChangeOrderForAcceptance()', () => {
  it('returns review_required with reason missing_tax_profile and never calls send_change_order_for_acceptance', async () => {
    const supabase = new FakeSupabaseClient({
      change_order_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
      org_tax_profiles: [ok(null)],
    });

    const result = await sendChangeOrderForAcceptance(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR });

    expect(result.status).toBe('review_required');
    if (result.status === 'review_required') {
      expect(result.reason).toBe('missing_tax_profile');
    }
    expect(supabase.callLog.some((c) => c.type === 'rpc' && c.name === 'send_change_order_for_acceptance')).toBe(false);
  });

  it('computes tax, calls send_change_order_for_acceptance, and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {
        change_order_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
        org_tax_profiles: [ok(TAX_PROFILE_ROW)],
      },
      {
        send_change_order_for_acceptance: [
          ok({
            ...CHANGE_ORDER_ROW,
            status: 'pending_acceptance',
            sent_line_items: [],
            sent_subtotal_cents: 30000,
            sent_discount_total_cents: 0,
            sent_tax_total_cents: 3900,
            sent_total_cents: 33900,
          }),
        ],
      }
    );

    const result = await sendChangeOrderForAcceptance(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.changeOrder.status).toBe('pending_acceptance');
      expect(result.changeOrder.sentTotalCents).toBe(33900n);
    }

    const rpcCall = supabase.callLog.find((c) => c.type === 'rpc' && c.name === 'send_change_order_for_acceptance');
    expect(rpcCall?.params.p_total_cents).toBe(33900);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a send_change_order_for_acceptance RPC error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {
        change_order_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
        org_tax_profiles: [ok(TAX_PROFILE_ROW)],
      },
      { send_change_order_for_acceptance: [dbError('invalid_transition: change order is not in draft status')] }
    );

    await expect(
      sendChangeOrderForAcceptance(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR })
    ).rejects.toThrow(/invalid_transition/);
  });

  it('throws when the change order has no line items at all', async () => {
    const supabase = new FakeSupabaseClient({ change_order_line_items: [ok([])] });
    await expect(
      sendChangeOrderForAcceptance(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR })
    ).rejects.toThrow(/no line items/);
  });
});

describe('recordChangeOrderAcceptance()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      recordChangeOrderAcceptance(supabase as never, {
        orgId: ORG_ID,
        changeOrderId: 'co-1',
        snapshotHash: 'deadbeef',
        acceptedSnapshot: {},
        typedName: 'Jane Doe',
        claimedAuthority: 'Owner',
        ...EXTERNAL_ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('calls record_change_order_acceptance and writes an external-actor audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        record_change_order_acceptance: [
          ok({
            id: 'acc-1',
            org_id: ORG_ID,
            change_order_id: 'co-1',
            snapshot_hash: 'deadbeef',
            accepted_snapshot: { title: 'Extra outlet' },
            typed_name: 'Jane Doe',
            claimed_authority: 'Owner',
            ip: '203.0.113.7',
            user_agent: 'Mozilla/5.0',
            accepted_at: '2026-09-13T00:00:00.000Z',
          }),
        ],
      }
    );

    const acceptance = await recordChangeOrderAcceptance(supabase as never, {
      orgId: ORG_ID,
      changeOrderId: 'co-1',
      snapshotHash: 'deadbeef',
      acceptedSnapshot: { title: 'Extra outlet' },
      typedName: 'Jane Doe',
      claimedAuthority: 'Owner',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      ...EXTERNAL_ACTOR,
    });

    expect(acceptance.id).toBe('acc-1');
    expect(acceptance.changeOrderId).toBe('co-1');

    const auditCall = supabase.callLog.find((c) => c.table === 'audit_logs');
    expect(auditCall).toBeDefined();
    const insertCall = auditCall?.methodCalls?.find((m) => m.method === 'insert');
    expect(insertCall?.args[0].external_actor_id).toBe('token-1');
    expect(insertCall?.args[0].external_actor_label).toBe('jane@client.example');
    expect(insertCall?.args[0].actor_user_id).toBeNull();
  });

  it('propagates a stale-change-order error (errcode 22023) from record_change_order_acceptance rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { record_change_order_acceptance: [dbError('stale_change_order: change order is not pending acceptance')] }
    );

    await expect(
      recordChangeOrderAcceptance(supabase as never, {
        orgId: ORG_ID,
        changeOrderId: 'co-1',
        snapshotHash: 'deadbeef',
        acceptedSnapshot: {},
        typedName: 'Jane Doe',
        claimedAuthority: 'Owner',
        ...EXTERNAL_ACTOR,
      })
    ).rejects.toThrow(/stale_change_order/);
  });
});

describe('issueChangeOrder()', () => {
  it('calls issue_change_order and writes an audit log entry with the resulting invoice id', async () => {
    const supabase = new FakeSupabaseClient({}, { issue_change_order: [ok({ id: 'inv-2' })] });

    const result = await issueChangeOrder(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR });

    expect(result).toEqual({ id: 'inv-2' });

    const auditCall = supabase.callLog.find((c) => c.table === 'audit_logs');
    expect(auditCall).toBeDefined();
    const insertCall = auditCall?.methodCalls?.find((m) => m.method === 'insert');
    expect(insertCall?.args[0].after_summary).toEqual({ resultingInvoiceId: 'inv-2' });
  });

  it('propagates an issue_change_order RPC error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { issue_change_order: [dbError('invalid_transition: change order is not accepted')] }
    );

    await expect(issueChangeOrder(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });
});

describe('voidChangeOrder()', () => {
  it('calls void_change_order and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        void_change_order: [
          ok({
            ...CHANGE_ORDER_ROW,
            status: 'void',
            voided_at: '2026-09-14T00:00:00.000Z',
            void_reason: 'customer declined',
          }),
        ],
      }
    );

    const changeOrder = await voidChangeOrder(supabase as never, {
      orgId: ORG_ID,
      changeOrderId: 'co-1',
      voidReason: 'customer declined',
      ...ACTOR,
    });

    expect(changeOrder.status).toBe('void');
    expect(changeOrder.voidReason).toBe('customer declined');
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a void_change_order RPC error (e.g. already issued)', async () => {
    const supabase = new FakeSupabaseClient({}, { void_change_order: [dbError('invalid_transition: change order is already issued')] });
    await expect(voidChangeOrder(supabase as never, { orgId: ORG_ID, changeOrderId: 'co-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });
});
