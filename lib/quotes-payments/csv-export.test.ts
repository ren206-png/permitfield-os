import { describe, expect, it } from 'vitest';
import { buildCsv, csvEscapeField, csvRow, exportInvoicesCsv, exportPaymentsCsv } from './csv-export';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

describe('csvEscapeField()', () => {
  it('returns a plain field unchanged when it needs no escaping', () => {
    expect(csvEscapeField('plain text')).toBe('plain text');
    expect(csvEscapeField('')).toBe('');
  });

  it('quotes and doubles embedded quotes when the field contains a double quote', () => {
    expect(csvEscapeField('Say "hello"')).toBe('"Say ""hello"""');
  });

  it('quotes a field containing a comma', () => {
    expect(csvEscapeField('Toronto, ON')).toBe('"Toronto, ON"');
  });

  it('quotes a field containing an embedded newline', () => {
    expect(csvEscapeField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes a field containing an embedded carriage return', () => {
    expect(csvEscapeField('line one\rline two')).toBe('"line one\rline two"');
  });

  it('quotes a field with both commas and quotes together', () => {
    expect(csvEscapeField('3" pipe, galvanized')).toBe('"3"" pipe, galvanized"');
  });
});

describe('csvRow() / buildCsv()', () => {
  it('joins escaped fields with commas and CRLF-terminates each row', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2, comma']]);
    expect(csv).toBe('a,b\r\n1,"2, comma"\r\n');
  });

  it('csvRow() alone joins without a trailing terminator', () => {
    expect(csvRow(['x', 'y, z'])).toBe('x,"y, z"');
  });
});

const ORG_ID = 'org-1';

describe('exportInvoicesCsv()', () => {
  it('produces a header row plus one row per issued invoice, with both cents and dollar columns', async () => {
    const supabase = new FakeSupabaseClient({
      invoices: [
        ok([
          {
            invoice_number: 1,
            status: 'issued',
            client_id: 'client-1',
            project_id: null,
            issued_at: '2026-09-13T12:00:00.000Z',
            due_date: '2026-09-27',
            currency_code: 'CAD',
            issued_subtotal_cents: 20000,
            issued_discount_total_cents: 0,
            issued_tax_total_cents: 2600,
            issued_total_cents: 22600,
            document_hash: 'abc123',
          },
        ]),
      ],
    });

    const csv = await exportInvoicesCsv(supabase as never, { orgId: ORG_ID, fromDate: '2026-09-01', toDate: '2026-09-30' });
    const lines = csv.trim().split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'invoice_number,status,client_id,project_id,issued_at,due_date,currency_code,subtotal_cents,discount_total_cents,tax_total_cents,total_cents,subtotal,discount_total,tax_total,total,document_hash'
    );
    expect(lines[1]).toContain('22600');
    expect(lines[1]).toContain('226.00');
  });

  it('propagates a real query error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({ invoices: [dbError('connection reset')] });
    await expect(
      exportInvoicesCsv(supabase as never, { orgId: ORG_ID, fromDate: '2026-09-01', toDate: '2026-09-30' })
    ).rejects.toThrow(/connection reset/);
  });

  it('produces only a header row when there are no matching invoices', async () => {
    const supabase = new FakeSupabaseClient({ invoices: [ok([])] });
    const csv = await exportInvoicesCsv(supabase as never, { orgId: ORG_ID, fromDate: '2026-09-01', toDate: '2026-09-30' });
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });
});

describe('exportPaymentsCsv()', () => {
  it('produces a header row plus one row per payment, including reversed ones with their reversal_reason', async () => {
    const supabase = new FakeSupabaseClient({
      payments: [
        ok([
          {
            method: 'e_transfer',
            status: 'reversed',
            client_id: 'client-1',
            received_at: '2026-09-13',
            currency_code: 'CAD',
            amount_cents: 22600,
            reference_note: 'ETR-123, urgent',
            reversal_reason: 'entered "in error"',
          },
        ]),
      ],
    });

    const csv = await exportPaymentsCsv(supabase as never, { orgId: ORG_ID, fromDate: '2026-09-01', toDate: '2026-09-30' });
    const lines = csv.trim().split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('reversed');
    expect(lines[1]).toContain('"ETR-123, urgent"');
    expect(lines[1]).toContain('"entered ""in error"""');
  });
});
