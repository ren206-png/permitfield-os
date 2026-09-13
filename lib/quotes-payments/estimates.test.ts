import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDraftEstimate,
  QuotesPaymentsDisabledError,
  replaceDraftEstimateLineItems,
  sendEstimate,
} from './estimates';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

// These tests run with PERMITFIELD_FF_BILLING unset (this repo's default
// test-process env, see lib/entitlements/index.test.ts's own header
// comment), so can('quotes.manage') resolves via LEGACY_DEFAULT_TIER, which
// grants it unconditionally -- no org_subscriptions row/Supabase mocking
// needed for the entitlement check itself. PERMITFIELD_FF_QUOTES_PAYMENTS is
// explicitly set/unset per test below since it defaults OFF.
beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const ACTOR = { actorUserId: 'user-1', actorRole: 'org_owner' as const };

describe('createDraftEstimate()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      createDraftEstimate(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        lineItems: [],
        ...ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('creates a draft estimate and its line items, then writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient({
      estimates: [
        ok({
          id: 'est-1',
          org_id: ORG_ID,
          client_id: 'client-1',
          project_id: null,
          status: 'draft',
          currency_code: 'CAD',
          expiry_date: null,
          scope_notes: null,
          exclusions: null,
          terms: null,
          current_revision_id: null,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        }),
      ],
      estimate_line_items: [ok(null)],
    });

    const result = await createDraftEstimate(supabase as never, {
      orgId: ORG_ID,
      clientId: 'client-1',
      lineItems: [{ description: 'Widget install', quantity: '2', unitPriceCents: 10000n }],
      ...ACTOR,
    });

    expect(result.id).toBe('est-1');
    expect(result.status).toBe('draft');
    const auditCalls = supabase.callLog.filter((c) => c.table === 'audit_logs');
    expect(auditCalls).toHaveLength(1);
  });

  it('propagates a real insert error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({
      estimates: [dbError('connection reset')],
    });
    await expect(
      createDraftEstimate(supabase as never, { orgId: ORG_ID, clientId: 'client-1', lineItems: [], ...ACTOR })
    ).rejects.toThrow(/connection reset/);
  });

  // Not tested here: the InsufficientEntitlementError path (PERMITFIELD_FF_BILLING=true,
  // no usable org_subscriptions row). lib/entitlements/index.ts's can() does
  // not accept a Supabase client at all -- it calls lib/supabase/server's
  // createClient() internally, which reads Next.js request cookies and
  // throws when invoked outside a real request context (as any test runner
  // call here would be). That DB-touching path already has its own coverage
  // via resolveEffectiveTier() in lib/entitlements/index.test.ts (a pure
  // function extracted specifically so this on-path logic is unit-testable
  // without mocking Supabase or Next's cookies()) -- re-deriving that
  // coverage here would mean mocking a module this file has no business
  // reaching into.
});

describe('replaceDraftEstimateLineItems()', () => {
  it('deletes existing line items then inserts the replacement set', async () => {
    const supabase = new FakeSupabaseClient({
      estimate_line_items: [
        ok(null),
        ok([
          {
            id: 'li-1',
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

    const result = await replaceDraftEstimateLineItems(supabase as never, {
      orgId: ORG_ID,
      estimateId: 'est-1',
      lineItems: [{ description: 'New line', quantity: '1', unitPriceCents: 5000n }],
      ...ACTOR,
    });

    expect(result).toHaveLength(1);
    expect(result[0].unitPriceCents).toBe(5000n);
  });

  it('propagates a delete error (e.g. RLS-blocked because the estimate is no longer draft)', async () => {
    const supabase = new FakeSupabaseClient({
      estimate_line_items: [dbError('permission denied for table estimate_line_items')],
    });
    await expect(
      replaceDraftEstimateLineItems(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', lineItems: [], ...ACTOR })
    ).rejects.toThrow(/permission denied/);
  });
});

describe('sendEstimate()', () => {
  const lineItemRows = [
    {
      id: 'li-1',
      description: 'Widget install',
      quantity: '2',
      unit_price_cents: 10000,
      discount_percent: null,
      discount_fixed_cents: null,
    },
  ];

  it('returns review_required with reason missing_tax_profile when org_tax_profiles has no row, and does not call send_estimate or write an audit log', async () => {
    const supabase = new FakeSupabaseClient({
      estimate_line_items: [ok(lineItemRows)],
      org_tax_profiles: [ok(null)],
    });

    const result = await sendEstimate(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', ...ACTOR });

    expect(result.status).toBe('review_required');
    if (result.status === 'review_required') {
      expect(result.reason).toBe('missing_tax_profile');
    }
    expect(supabase.callLog.some((c) => c.type === 'rpc' && c.name === 'send_estimate')).toBe(false);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(false);
  });

  it('returns review_required with reason unknown_gst_hst_status when the profile has an unknown GST/HST status', async () => {
    const supabase = new FakeSupabaseClient({
      estimate_line_items: [ok(lineItemRows)],
      org_tax_profiles: [
        ok({
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
          gst_hst_status: 'unknown',
          gst_hst_number: null,
          bc_pst_status: 'unregistered',
          bc_pst_number: null,
        }),
      ],
    });

    const result = await sendEstimate(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', ...ACTOR });

    expect(result.status).toBe('review_required');
    if (result.status === 'review_required') {
      expect(result.reason).toBe('unknown_gst_hst_status');
    }
  });

  it('computes tax, calls send_estimate with the computed totals, and writes an audit log entry on success', async () => {
    const supabase = new FakeSupabaseClient(
      {
        estimate_line_items: [ok(lineItemRows)],
        org_tax_profiles: [
          ok({
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
          }),
        ],
      },
      {
        send_estimate: [
          ok({
            id: 'rev-1',
            org_id: ORG_ID,
            estimate_id: 'est-1',
            revision_number: 1,
            sent_at: '2026-09-13T00:00:00.000Z',
            currency_code: 'CAD',
            expiry_date: null,
            scope_notes: null,
            exclusions: null,
            terms: null,
            line_items: [],
            subtotal_cents: 20000,
            discount_total_cents: 0,
            tax_total_cents: 2600,
            total_cents: 22600,
          }),
        ],
      }
    );

    const result = await sendEstimate(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', ...ACTOR });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.revision.totalCents).toBe(22600n);
      expect(result.revision.taxTotalCents).toBe(2600n);
    }

    const rpcCall = supabase.callLog.find((c) => c.type === 'rpc' && c.name === 'send_estimate');
    expect(rpcCall?.params.p_subtotal_cents).toBe(20000);
    expect(rpcCall?.params.p_tax_total_cents).toBe(2600);
    expect(rpcCall?.params.p_total_cents).toBe(22600);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a send_estimate RPC error (e.g. stale/non-draft estimate) rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {
        estimate_line_items: [ok(lineItemRows)],
        org_tax_profiles: [
          ok({
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
          }),
        ],
      },
      {
        send_estimate: [dbError('invalid_transition: estimate is not in draft status')],
      }
    );

    await expect(sendEstimate(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });

  it('throws when the estimate has no line items at all', async () => {
    const supabase = new FakeSupabaseClient({ estimate_line_items: [ok([])] });
    await expect(sendEstimate(supabase as never, { orgId: ORG_ID, estimateId: 'est-1', ...ACTOR })).rejects.toThrow(
      /no line items/
    );
  });
});
