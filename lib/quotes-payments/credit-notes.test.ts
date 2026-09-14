import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotesPaymentsDisabledError } from './estimates';
import { createDraftCreditNote, issueCreditNote, voidCreditNote } from './credit-notes';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const ACTOR = { actorUserId: 'user-1', actorRole: 'org_owner' as const };

const CREDIT_NOTE_ROW = {
  id: 'cn-1',
  org_id: ORG_ID,
  client_id: 'client-1',
  invoice_id: 'inv-1',
  status: 'draft',
  currency_code: 'CAD',
  reason: null,
  credit_note_number: null,
  issued_at: null,
  voided_at: null,
  void_reason: null,
  amount_cents: 20000,
  issued_amount_cents: null,
  document_hash: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

describe('createDraftCreditNote()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      createDraftCreditNote(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        invoiceId: 'inv-1',
        amountCents: 20000n,
        ...ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('creates a draft credit note and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient({ credit_notes: [ok(CREDIT_NOTE_ROW)] });

    const result = await createDraftCreditNote(supabase as never, {
      orgId: ORG_ID,
      clientId: 'client-1',
      invoiceId: 'inv-1',
      amountCents: 20000n,
      reason: 'Overcharge correction',
      ...ACTOR,
    });

    expect(result.id).toBe('cn-1');
    expect(result.status).toBe('draft');
    expect(result.amountCents).toBe(20000n);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a real insert error rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({ credit_notes: [dbError('connection reset')] });
    await expect(
      createDraftCreditNote(supabase as never, {
        orgId: ORG_ID,
        clientId: 'client-1',
        invoiceId: 'inv-1',
        amountCents: 20000n,
        ...ACTOR,
      })
    ).rejects.toThrow(/connection reset/);
  });
});

describe('issueCreditNote()', () => {
  it('calls issue_credit_note and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        issue_credit_note: [
          ok({
            ...CREDIT_NOTE_ROW,
            status: 'issued',
            credit_note_number: 1,
            issued_at: '2026-09-13T00:00:00.000Z',
            issued_amount_cents: 20000,
          }),
        ],
      }
    );

    const result = await issueCreditNote(supabase as never, { orgId: ORG_ID, creditNoteId: 'cn-1', ...ACTOR });

    expect(result.status).toBe('issued');
    expect(result.creditNoteNumber).toBe(1n);
    expect(result.issuedAmountCents).toBe(20000n);

    const auditCall = supabase.callLog.find((c) => c.table === 'audit_logs');
    expect(auditCall).toBeDefined();
    const insertCall = auditCall?.methodCalls?.find((m) => m.method === 'insert');
    expect(insertCall?.args[0].after_summary).toEqual({ creditNoteNumber: '1', issuedAmountCents: '20000' });
  });

  it('propagates an issue_credit_note RPC error (e.g. outstanding balance exceeded) rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { issue_credit_note: [dbError('invalid_transition: credit note amount exceeds outstanding invoice balance')] }
    );

    await expect(issueCreditNote(supabase as never, { orgId: ORG_ID, creditNoteId: 'cn-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });
});

describe('voidCreditNote()', () => {
  it('calls void_credit_note and writes an audit log entry', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      {
        void_credit_note: [
          ok({
            ...CREDIT_NOTE_ROW,
            status: 'void',
            credit_note_number: 1,
            issued_at: '2026-09-13T00:00:00.000Z',
            issued_amount_cents: 20000,
            voided_at: '2026-09-14T00:00:00.000Z',
            void_reason: 'issued in error',
          }),
        ],
      }
    );

    const creditNote = await voidCreditNote(supabase as never, {
      orgId: ORG_ID,
      creditNoteId: 'cn-1',
      voidReason: 'issued in error',
      ...ACTOR,
    });

    expect(creditNote.status).toBe('void');
    expect(creditNote.voidReason).toBe('issued in error');
    // credit_note_number is never reclaimed on void.
    expect(creditNote.creditNoteNumber).toBe(1n);
    expect(supabase.callLog.some((c) => c.table === 'audit_logs')).toBe(true);
  });

  it('propagates a void_credit_note RPC error (e.g. still draft) rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient({}, { void_credit_note: [dbError('invalid_transition: credit note is not issued')] });
    await expect(voidCreditNote(supabase as never, { orgId: ORG_ID, creditNoteId: 'cn-1', ...ACTOR })).rejects.toThrow(
      /invalid_transition/
    );
  });
});
