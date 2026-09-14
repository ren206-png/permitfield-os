// Gate 4 (Quotes & Payments), Phase B service layer -- credit note
// lifecycle: draft creation, `issue_credit_note()`, `void_credit_note()`
// (see supabase/migrations/20260806000052_change_orders_and_credit_notes.sql
// for the full RPC/RLS contract this module wraps).
//
// Deliberately much thinner than invoices.ts/change-orders.ts: a credit
// note has no line items and no tax calculation of its own (per
// GATE_4_PHASE_B_FINDINGS.md §III Q5's "minimal artifact" framing) -- just a
// single signed-positive amount_cents and a free-text reason. It reduces
// what's owed on `invoice_id` without recomputing that invoice's own tax
// breakdown; the "no calculation logic in SQL" rule this gate applies
// everywhere else is trivially satisfied here since there is no
// calculation to perform at all, only a bound check (which the RPC itself
// enforces, mirroring 20260806000051_record_payment_invoice_guards.sql's
// precedent -- see issue_credit_note()'s own header comment for the full
// reasoning).
//
// Everything here folds under the existing `invoices.manage` entitlement,
// per §III Q6 -- no new entitlement was added.
import type { Role } from '@/lib/authz';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import { centsToDbValue, dbValueToCents, dbValueToCentsOrNull } from './db-mapping';
import type { QPClient } from './types';
import { QuotesPaymentsDisabledError, InsufficientEntitlementError } from './estimates';

async function assertCreditNotesEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'invoices.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'invoices.manage');
  }
}

export type CreditNoteStatus = 'draft' | 'issued' | 'void';

export interface CreditNoteRecord {
  id: string;
  orgId: string;
  clientId: string;
  invoiceId: string;
  status: CreditNoteStatus;
  currencyCode: string;
  reason: string | null;
  creditNoteNumber: bigint | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  amountCents: bigint | null;
  issuedAmountCents: bigint | null;
  documentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCreditNoteRow(row: any): CreditNoteRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    invoiceId: row.invoice_id,
    status: row.status,
    currencyCode: row.currency_code,
    reason: row.reason ?? null,
    creditNoteNumber: row.credit_note_number === null || row.credit_note_number === undefined ? null : dbValueToCents(row.credit_note_number),
    issuedAt: row.issued_at ?? null,
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    amountCents: dbValueToCentsOrNull(row.amount_cents),
    issuedAmountCents: dbValueToCentsOrNull(row.issued_amount_cents),
    documentHash: row.document_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateDraftCreditNoteParams {
  orgId: string;
  clientId: string;
  invoiceId: string;
  amountCents: bigint;
  reason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/** Creates a draft credit note. Ordinary RLS-enforced INSERT, no RPC -- drafting is not a privileged action, same reasoning as createDraftInvoice()/createDraftChangeOrder(). The outstanding-balance guard only runs at issue_credit_note() time (see that RPC's header comment), not here -- a draft credit note is not yet a real financial commitment. */
export async function createDraftCreditNote(supabase: QPClient, params: CreateDraftCreditNoteParams): Promise<CreditNoteRecord> {
  await assertCreditNotesEntitlement(params.orgId);

  const { data: creditNoteRow, error: creditNoteError } = await supabase
    .from('credit_notes')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      invoice_id: params.invoiceId,
      amount_cents: centsToDbValue(params.amountCents),
      reason: params.reason ?? null,
      created_by: params.actorUserId,
    })
    .select()
    .single();

  if (creditNoteError || !creditNoteRow) {
    throw new Error(`Failed to create draft credit note: ${creditNoteError?.message ?? 'no row returned'}`);
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'credit_note.drafted',
    entityType: 'credit_notes',
    entityId: creditNoteRow.id,
    afterSummary: {
      clientId: params.clientId,
      invoiceId: params.invoiceId,
      amountCents: params.amountCents.toString(),
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for credit_note.drafted (credit note ${creditNoteRow.id}): ${auditError}`);
  }

  return mapCreditNoteRow(creditNoteRow);
}

export interface IssueCreditNoteParams {
  orgId: string;
  creditNoteId: string;
  actorUserId: string;
  actorRole: Role;
}

/**
 * Locks in the credit note via `issue_credit_note()`, which assigns
 * credit_note_number and re-validates the target invoice's outstanding
 * balance can absorb it (row-locked for the duration of that RPC's
 * transaction -- see the migration's header comment). No document_hash is
 * computed here (unlike issueInvoice()'s sha256-of-line-items) since a
 * credit note has no line items to hash; the column exists for parity with
 * invoices/estimates' "second independent proof of what was issued"
 * convention but is left null in this pass, matching the migration's own
 * `document_hash = null` in issue_credit_note()'s UPDATE.
 */
export async function issueCreditNote(supabase: QPClient, params: IssueCreditNoteParams): Promise<CreditNoteRecord> {
  await assertCreditNotesEntitlement(params.orgId);

  const { data: creditNoteRow, error: rpcError } = await supabase.rpc('issue_credit_note', {
    p_credit_note_id: params.creditNoteId,
  });

  if (rpcError) {
    throw new Error(`issue_credit_note RPC failed for credit note ${params.creditNoteId}: ${rpcError.message}`);
  }
  if (!creditNoteRow) {
    throw new Error(`issue_credit_note RPC returned no row for credit note ${params.creditNoteId}.`);
  }

  const creditNote = mapCreditNoteRow(creditNoteRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'credit_note.issued',
    entityType: 'credit_notes',
    entityId: params.creditNoteId,
    afterSummary: {
      creditNoteNumber: creditNote.creditNoteNumber === null ? null : creditNote.creditNoteNumber.toString(),
      issuedAmountCents: creditNote.issuedAmountCents === null ? null : creditNote.issuedAmountCents.toString(),
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for credit_note.issued (credit note ${params.creditNoteId}): ${auditError}`);
  }

  return creditNote;
}

export interface VoidCreditNoteParams {
  orgId: string;
  creditNoteId: string;
  voidReason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/** Voids an issued credit note via `void_credit_note()`. Never reclaims the credit_note_number (see migration header comment). Releases the balance it had reduced back onto the invoice's outstanding total, since the outstanding-balance formula only sums status = 'issued' credit notes. */
export async function voidCreditNote(supabase: QPClient, params: VoidCreditNoteParams): Promise<CreditNoteRecord> {
  await assertCreditNotesEntitlement(params.orgId);

  const { data: creditNoteRow, error: rpcError } = await supabase.rpc('void_credit_note', {
    p_credit_note_id: params.creditNoteId,
    p_void_reason: params.voidReason ?? null,
  });

  if (rpcError) {
    throw new Error(`void_credit_note RPC failed for credit note ${params.creditNoteId}: ${rpcError.message}`);
  }
  if (!creditNoteRow) {
    throw new Error(`void_credit_note RPC returned no row for credit note ${params.creditNoteId}.`);
  }

  const creditNote = mapCreditNoteRow(creditNoteRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'credit_note.voided',
    entityType: 'credit_notes',
    entityId: params.creditNoteId,
    afterSummary: { voidReason: params.voidReason ?? null },
  });
  if (auditError) {
    console.error(`Failed to write audit log for credit_note.voided (credit note ${params.creditNoteId}): ${auditError}`);
  }

  return creditNote;
}
