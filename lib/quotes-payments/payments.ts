// Gate 4 (Quotes & Payments), Phase A service layer -- manual payment
// recording (e-transfer / cheque only, per
// supabase/migrations/20260806000056_payments.sql's own header comment: "no
// online/card payment processor integration exists anywhere in this
// migration, and none is implied by it"). Thin wrappers around
// `record_payment()` and `reverse_payment()`, the sole write paths (there is
// no direct authenticated INSERT/UPDATE policy on `payments` at all -- see
// that migration's header comment on why payments get a stricter posture
// than estimates/invoices' draft-editable tables).
import type { Role } from '@/lib/authz';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import { centsToDbValue, dbValueToCents } from './db-mapping';
import type { QPClient } from './types';
import { QuotesPaymentsDisabledError, InsufficientEntitlementError } from './estimates';

async function assertPaymentsEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'payments.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'payments.manage');
  }
}

export type PaymentMethod = 'e_transfer' | 'cheque';
export type PaymentStatus = 'recorded' | 'reversed';

export interface PaymentRecord {
  id: string;
  orgId: string;
  clientId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: bigint;
  currencyCode: string;
  referenceNote: string | null;
  receivedAt: string;
  recordedBy: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPaymentRow(row: any): PaymentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    method: row.method,
    status: row.status,
    amountCents: dbValueToCents(row.amount_cents),
    currencyCode: row.currency_code,
    referenceNote: row.reference_note ?? null,
    receivedAt: row.received_at,
    recordedBy: row.recorded_by ?? null,
    reversedBy: row.reversed_by ?? null,
    reversedAt: row.reversed_at ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PaymentAllocationInput {
  invoiceId: string;
  amountCents: bigint;
}

export interface RecordPaymentParams {
  orgId: string;
  clientId: string;
  method: PaymentMethod;
  amountCents: bigint;
  receivedAt: string;
  referenceNote?: string | null;
  allocations?: PaymentAllocationInput[];
  actorUserId: string;
  actorRole: Role;
}

/**
 * Records a manual payment (+ optional invoice allocations) via
 * `record_payment()`. The RPC itself validates that, when any allocations
 * are supplied, their amounts sum exactly to `amountCents` -- this wrapper
 * does not duplicate that check client-side (it is structural/arithmetic,
 * not business math, and re-implementing it here would just be a second
 * place for the two checks to silently drift apart); a mismatch surfaces as
 * a thrown Error from the propagated RPC error (Postgres errcode '22023').
 */
export async function recordPayment(supabase: QPClient, params: RecordPaymentParams): Promise<PaymentRecord> {
  await assertPaymentsEntitlement(params.orgId);

  const allocations = (params.allocations ?? []).map((a) => ({
    invoice_id: a.invoiceId,
    amount_cents: centsToDbValue(a.amountCents),
  }));

  const { data: paymentRow, error: rpcError } = await supabase.rpc('record_payment', {
    p_org_id: params.orgId,
    p_client_id: params.clientId,
    p_method: params.method,
    p_amount_cents: centsToDbValue(params.amountCents),
    p_received_at: params.receivedAt,
    p_reference_note: params.referenceNote ?? null,
    p_allocations: allocations,
  });

  if (rpcError) {
    throw new Error(`record_payment RPC failed for org ${params.orgId}: ${rpcError.message}`);
  }
  if (!paymentRow) {
    throw new Error(`record_payment RPC returned no row for org ${params.orgId}.`);
  }

  const payment = mapPaymentRow(paymentRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'payment.recorded',
    entityType: 'payments',
    entityId: payment.id,
    afterSummary: {
      method: payment.method,
      amountCents: payment.amountCents.toString(),
      clientId: params.clientId,
      allocationCount: allocations.length,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for payment.recorded (payment ${payment.id}): ${auditError}`);
  }

  return payment;
}

export interface ReversePaymentParams {
  orgId: string;
  paymentId: string;
  reversalReason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/** Reverses a recorded payment via `reverse_payment()`. Never deletes or edits payment_allocations rows (see migration header comment) -- this wrapper only flips the payment's own status. */
export async function reversePayment(supabase: QPClient, params: ReversePaymentParams): Promise<PaymentRecord> {
  await assertPaymentsEntitlement(params.orgId);

  const { data: paymentRow, error: rpcError } = await supabase.rpc('reverse_payment', {
    p_payment_id: params.paymentId,
    p_reversal_reason: params.reversalReason ?? null,
  });

  if (rpcError) {
    throw new Error(`reverse_payment RPC failed for payment ${params.paymentId}: ${rpcError.message}`);
  }
  if (!paymentRow) {
    throw new Error(`reverse_payment RPC returned no row for payment ${params.paymentId}.`);
  }

  const payment = mapPaymentRow(paymentRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'payment.reversed',
    entityType: 'payments',
    entityId: params.paymentId,
    afterSummary: { reversalReason: params.reversalReason ?? null },
  });
  if (auditError) {
    console.error(`Failed to write audit log for payment.reversed (payment ${params.paymentId}): ${auditError}`);
  }

  return payment;
}
