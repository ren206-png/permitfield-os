import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotesPaymentsDisabledError } from './estimates';
import { createDraftInvoice, issueInvoice, replaceDraftInvoiceLineItems, voidInvoice } from './invoices';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const ACTOR = { actorUserId: 'user-1', actorRole: 'org_owner' as const };

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
    description: 'Widget install',
    quantity: '2',
    unit_price_cents: 10000,
    discount_percent: null,
    discount_fixed_cents: null,
  },
];

describe('createDraftInvoice()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      createDraftInvoice(supabase as never, { orgId: ORG_ID, clientId: 'client-1', lineItems: [], ...ACTOR })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('creates a draft invoice + line items and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient({
      invoices: [
        ok({
          id: 'inv-1',
          org_id: ORG_ID,
          client_id: 'client-1',
          project_id: null,
          source_estimate_id: null,
          status: 'draft',
          currency_code: 'CAD',
          invoice_number: null,
          due_date: null,
          issued_at: null,
          voided_at: null,
          void_reason: null,
          scope_notes: null,
          terms: null,
          subtotal_cents: null,
          discount_total_cents: null,
          tax_total_cents: null,
          total_cents: null,
          issued_line_items: null,
          issued_subtotal_cents: null,
          issued_discount_total_cents: null,
          issued_tax_total_cents: null,
          issued_total_cents: null,
          document_hash: null,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        }),
      ],
      invoice_line_items: [ok(null)],
    });

    const result = await createDraftInvoice(supabase as never, {
      orgId: ORG_ID,
      clientId: 'client-1',
      lineItems: [{ description: 'Widget install', quantity: '2', unitPriceCents: 10000n }],
      ...ACTOR,
    });

    expect(result.id).toBe('inv-1');
    expect(result.status).toBe('draft');
    expect(result.invoiceNumber).toBeNull();
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a real insert error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({ invoices: [dbError('connection reset')] });
    await expect(
      createDraftInvoice(supabase as never, { orgId: ORG_ID, clientId: 'client-1', lineItems: [], ...ACTOR })
    ).rejects.toThrow(/connection reset/);
  });
});

describe('replaceDraftInvoiceLineItems()', () => {
  it('deletes existing line items then inserts the replacement set', async () => {
    const supabase = new FakeSupabaseClient({
      invoice_line_items: [
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

    const result = await replaceDraftInvoiceLineItems(supabase as never, {
      orgId: ORG_ID,
      invoiceId: 'inv-1',
      lineItems: [{ description: 'New line', quantity: '1', unitPriceCents: 5000n }],
      ...ACTOR,
    });

    expect(result).toHaveLength(1);
    expect(result[0].unitPriceCents).toBe(5000n);
  });
});

describe('issueInvoice()', () => {
  it('returns review_required with reason missing_tax_profile and never calls issue_invoice', async () => {
    const supabase = new FakeSupabaseClient({
      invoice_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
      org_tax_profiles: [ok(null)],
    });

    const result = await issueInvoice(supabase as never, { orgId: ORG_ID, invoiceId: 'inv-1', ...ACTOR });

    expect(result.status).toBe('review_required');
    if (result.status === 'review_required') {
      expect(result.reason).toBe('missing_tax_profile');
    }
    expect(supabase.callLog.some((c) => c.type === 'rpc' && c.name === 'issue_invoice')).toBe(false);
  });

  it('computes tax, calls issue_invoice with a sha256 document hash, and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {
        invoice_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
        org_tax_profiles: [ok(TAX_PROFILE_ROW)],
      },
      {
        issue_invoice: [
          ok({
            id: 'inv-1',
            org_id: ORG_ID,
            client_id: 'client-1',
            project_id: null,
            source_estimate_id: null,
            status: 'issued',
            currency_code: 'CAD',
            invoice_number: 1,
            due_date: null,
            issued_at: '2026-09-13T00:00:00.000Z',
            voided_at: null,
            void_reason: null,
            scope_notes: null,
            terms: null,
            subtotal_cents: 20000,
            discount_total_cents: 0,
            tax_total_cents: 2600,
            total_cents: 22600,
            issued_line_items: [],
            issued_subtotal_cents: 20000,
            issued_discount_total_cents: 0,
            issued_tax_total_cents: 2600,
            issued_total_cents: 22600,
            document_hash: 'placeholder-not-checked-verbatim',
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: '2026-09-13T00:00:00.000Z',
          }),
        ],
      }
    );

    const result = await issueInvoice(supabase as never, { orgId: ORG_ID, invoiceId: 'inv-1', ...ACTOR });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.invoice.issuedTotalCents).toBe(22600n);
      expect(result.invoice.invoiceNumber).toBe(1n);
    }

    const rpcCall = supabase.callLog.find((c) => c.type === 'rpc' && c.name === 'issue_invoice');
    expect(rpcCall?.params.p_total_cents).toBe(22600);
    expect(typeof rpcCall?.params.p_document_hash).toBe('string');
    // sha256 hex digest: exactly 64 hex characters.
    expect(rpcCall?.params.p_document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates an issue_invoice RPC error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {
        invoice_line_items: [ok(DRAFT_LINE_ITEM_ROWS)],
        org_tax_profiles: [ok(TAX_PROFILE_ROW)],
      },
      { issue_invoice: [dbError('invalid_transition: invoice is not in draft status')] }
    );

    await expect(issueInvoice(supabase as never, { orgId: ORG_ID, invoiceId: 'inv-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });

  it('throws when the invoice has no line items at all', async () => {
    const supabase = new FakeSupabaseClient({ invoice_line_items: [ok([])] });
    await expect(issueInvoice(supabase as never, { orgId: ORG_ID, invoiceId: 'inv-1', ...ACTOR })).rejects.toThrow(
      /no line items/
    );
  });
});

describe('voidInvoice()', () => {
  it('calls void_invoice and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        void_invoice: [
          ok({
            id: 'inv-1',
            org_id: ORG_ID,
            client_id: 'client-1',
            project_id: null,
            source_estimate_id: null,
            status: 'void',
            currency_code: 'CAD',
            invoice_number: 1,
            due_date: null,
            issued_at: '2026-09-13T00:00:00.000Z',
            voided_at: '2026-09-14T00:00:00.000Z',
            void_reason: 'client requested cancellation',
            scope_notes: null,
            terms: null,
            subtotal_cents: 20000,
            discount_total_cents: 0,
            tax_total_cents: 2600,
            total_cents: 22600,
            issued_line_items: [],
            issued_subtotal_cents: 20000,
            issued_discount_total_cents: 0,
            issued_tax_total_cents: 2600,
            issued_total_cents: 22600,
            document_hash: 'abc123',
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: '2026-09-14T00:00:00.000Z',
          }),
        ],
      }
    );

    const invoice = await voidInvoice(supabase as never, {
      orgId: ORG_ID,
      invoiceId: 'inv-1',
      voidReason: 'client requested cancellation',
      ...ACTOR,
    });

    expect(invoice.status).toBe('void');
    expect(invoice.voidReason).toBe('client requested cancellation');
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a void_invoice RPC error (e.g. invoice not currently issued)', async () => {
    const supabase = new FakeSupabaseClient({}, { void_invoice: [dbError('invalid_transition: invoice is not issued')] });
    await expect(voidInvoice(supabase as never, { orgId: ORG_ID, invoiceId: 'inv-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });
});
