// Gate 4 (Quotes & Payments), Phase B service layer -- change order
// lifecycle: draft creation, draft line-item editing,
// `send_change_order_for_acceptance()`, `record_change_order_acceptance()`,
// `issue_change_order()`, and `void_change_order()` (see
// supabase/migrations/20260806000062_change_orders_and_credit_notes.sql for
// the full RPC/RLS contract this module wraps). Mirrors
// lib/quotes-payments/invoices.ts's shape deliberately -- same
// draft/immutable-snapshot split, same tax-then-RPC ordering for the
// send-for-acceptance step, same audit-log discipline -- per this gate's
// established "don't let two lifecycle modules solving the same shape of
// problem drift into different conventions" rule (invoices.ts's own header
// comment states this explicitly for itself vs. estimates.ts).
//
// Everything here folds under the existing `invoices.manage` entitlement,
// per GATE_4_PHASE_B_FINDINGS.md §III Q6 -- no new entitlement was added.
import type { Role } from '@/lib/authz';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import type { TaxLineItemInput } from '@/lib/tax/types';
import { centsToDbValue, dbValueToCents, dbValueToCentsOrNull } from './db-mapping';
import { computeTaxOutcome, serializeLineItemBreakdowns, type QuotesPaymentsReviewReason } from './tax-result';
import type { LineItemDraftInput, LineItemRecord, QPClient } from './types';
import { QuotesPaymentsDisabledError, InsufficientEntitlementError } from './estimates';

async function assertChangeOrdersEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'invoices.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'invoices.manage');
  }
}

export type ChangeOrderStatus = 'draft' | 'pending_acceptance' | 'accepted' | 'issued' | 'void';

export interface ChangeOrderRecord {
  id: string;
  orgId: string;
  clientId: string;
  sourceInvoiceId: string;
  status: ChangeOrderStatus;
  currencyCode: string;
  title: string;
  description: string | null;
  subtotalCents: bigint | null;
  discountTotalCents: bigint | null;
  taxTotalCents: bigint | null;
  totalCents: bigint | null;
  sentLineItems: unknown;
  sentSubtotalCents: bigint | null;
  sentDiscountTotalCents: bigint | null;
  sentTaxTotalCents: bigint | null;
  sentTotalCents: bigint | null;
  resultingInvoiceId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapChangeOrderRow(row: any): ChangeOrderRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    sourceInvoiceId: row.source_invoice_id,
    status: row.status,
    currencyCode: row.currency_code,
    title: row.title,
    description: row.description ?? null,
    subtotalCents: dbValueToCentsOrNull(row.subtotal_cents),
    discountTotalCents: dbValueToCentsOrNull(row.discount_total_cents),
    taxTotalCents: dbValueToCentsOrNull(row.tax_total_cents),
    totalCents: dbValueToCentsOrNull(row.total_cents),
    sentLineItems: row.sent_line_items ?? null,
    sentSubtotalCents: dbValueToCentsOrNull(row.sent_subtotal_cents),
    sentDiscountTotalCents: dbValueToCentsOrNull(row.sent_discount_total_cents),
    sentTaxTotalCents: dbValueToCentsOrNull(row.sent_tax_total_cents),
    sentTotalCents: dbValueToCentsOrNull(row.sent_total_cents),
    resultingInvoiceId: row.resulting_invoice_id ?? null,
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLineItemRow(row: any): LineItemRecord {
  return {
    id: row.id,
    description: row.description,
    quantity: String(row.quantity),
    unitPriceCents: dbValueToCents(row.unit_price_cents),
    discountPercent: row.discount_percent === null || row.discount_percent === undefined ? null : String(row.discount_percent),
    discountFixedCents: dbValueToCentsOrNull(row.discount_fixed_cents),
    position: row.position,
  };
}

function lineItemInsertPayload(orgId: string, changeOrderId: string, lineItems: readonly LineItemDraftInput[]) {
  return lineItems.map((li, idx) => ({
    org_id: orgId,
    change_order_id: changeOrderId,
    position: li.position ?? idx,
    description: li.description,
    quantity: li.quantity,
    unit_price_cents: centsToDbValue(li.unitPriceCents),
    discount_percent: li.discountPercent ?? null,
    discount_fixed_cents: centsToDbValue(li.discountFixedCents ?? null),
  }));
}

export interface CreateDraftChangeOrderParams {
  orgId: string;
  clientId: string;
  sourceInvoiceId: string;
  title: string;
  description?: string | null;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/** Creates a draft change order + its initial line items. Ordinary RLS-enforced INSERTs, no RPC -- drafting is not a privileged action (same reasoning as createDraftInvoice()). */
export async function createDraftChangeOrder(supabase: QPClient, params: CreateDraftChangeOrderParams): Promise<ChangeOrderRecord> {
  await assertChangeOrdersEntitlement(params.orgId);

  const { data: changeOrderRow, error: changeOrderError } = await supabase
    .from('change_orders')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      source_invoice_id: params.sourceInvoiceId,
      title: params.title,
      description: params.description ?? null,
      created_by: params.actorUserId,
    })
    .select()
    .single();

  if (changeOrderError || !changeOrderRow) {
    throw new Error(`Failed to create draft change order: ${changeOrderError?.message ?? 'no row returned'}`);
  }

  if (params.lineItems.length > 0) {
    const { error: lineItemsError } = await supabase
      .from('change_order_line_items')
      .insert(lineItemInsertPayload(params.orgId, changeOrderRow.id, params.lineItems));
    if (lineItemsError) {
      throw new Error(`Failed to create draft change order line items for change order ${changeOrderRow.id}: ${lineItemsError.message}`);
    }
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'change_order.drafted',
    entityType: 'change_orders',
    entityId: changeOrderRow.id,
    afterSummary: {
      clientId: params.clientId,
      sourceInvoiceId: params.sourceInvoiceId,
      lineItemCount: params.lineItems.length,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.drafted (change order ${changeOrderRow.id}): ${auditError}`);
  }

  return mapChangeOrderRow(changeOrderRow);
}

export interface ReplaceDraftChangeOrderLineItemsParams {
  orgId: string;
  changeOrderId: string;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/** Replaces the full set of line items on a still-draft change order (delete all, then insert the new set) -- same delete-then-insert semantics as replaceDraftInvoiceLineItems(). */
export async function replaceDraftChangeOrderLineItems(
  supabase: QPClient,
  params: ReplaceDraftChangeOrderLineItemsParams
): Promise<LineItemRecord[]> {
  await assertChangeOrdersEntitlement(params.orgId);

  const { error: deleteError } = await supabase
    .from('change_order_line_items')
    .delete()
    .eq('org_id', params.orgId)
    .eq('change_order_id', params.changeOrderId);
  if (deleteError) {
    throw new Error(`Failed to clear existing line items for change order ${params.changeOrderId}: ${deleteError.message}`);
  }

  let insertedRows: LineItemRecord[] = [];
  if (params.lineItems.length > 0) {
    const { data, error: insertError } = await supabase
      .from('change_order_line_items')
      .insert(lineItemInsertPayload(params.orgId, params.changeOrderId, params.lineItems))
      .select();
    if (insertError) {
      throw new Error(`Failed to insert replacement line items for change order ${params.changeOrderId}: ${insertError.message}`);
    }
    insertedRows = (data ?? []).map(mapLineItemRow);
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'change_order.line_items_updated',
    entityType: 'change_orders',
    entityId: params.changeOrderId,
    afterSummary: { lineItemCount: params.lineItems.length },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.line_items_updated (change order ${params.changeOrderId}): ${auditError}`);
  }

  return insertedRows;
}

export interface SendChangeOrderForAcceptanceParams {
  orgId: string;
  changeOrderId: string;
  actorUserId: string;
  actorRole: Role;
}

export type SendChangeOrderForAcceptanceResult =
  | { status: 'ok'; changeOrder: ChangeOrderRecord }
  | { status: 'review_required'; reason: QuotesPaymentsReviewReason; message: string };

/**
 * Locks in the immutable sent_* snapshot by calling
 * `send_change_order_for_acceptance()`. Same tax-before-RPC ordering as
 * issueInvoice(): loads the change order's current draft line items,
 * resolves the org's tax profile, runs calculateTax(), and only calls the
 * RPC on an `'ok'` tax outcome -- change_order_line_items.unit_price_cents
 * is constrained >= 0 at the DB layer (see this migration's "ADDITIONS
 * ONLY" header comment), matching calculateTax()'s own hard requirement
 * that no line item price negative, so no separate guard is needed here
 * beyond what the DB and the tax engine already enforce.
 */
export async function sendChangeOrderForAcceptance(
  supabase: QPClient,
  params: SendChangeOrderForAcceptanceParams
): Promise<SendChangeOrderForAcceptanceResult> {
  await assertChangeOrdersEntitlement(params.orgId);

  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from('change_order_line_items')
    .select('id, description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
    .eq('org_id', params.orgId)
    .eq('change_order_id', params.changeOrderId)
    .order('position', { ascending: true });

  if (lineItemsError) {
    throw new Error(`Failed to load line items for change order ${params.changeOrderId}: ${lineItemsError.message}`);
  }
  if (!lineItemRows || lineItemRows.length === 0) {
    throw new Error(`Change order ${params.changeOrderId} has no line items; cannot send an empty change order for acceptance.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taxLineItems: TaxLineItemInput[] = lineItemRows.map((row: any) => ({
    id: row.id,
    description: row.description,
    quantity: String(row.quantity),
    unitPriceCents: dbValueToCents(row.unit_price_cents),
    discountPercent: row.discount_percent === null || row.discount_percent === undefined ? null : String(row.discount_percent),
    discountFixedCents: dbValueToCentsOrNull(row.discount_fixed_cents),
  }));

  const taxOutcome = await computeTaxOutcome(supabase, params.orgId, taxLineItems);
  if (taxOutcome.status === 'review_required') {
    return { status: 'review_required', reason: taxOutcome.reason, message: taxOutcome.message };
  }

  const { result } = taxOutcome;
  const sentLineItems = serializeLineItemBreakdowns(result.lineItems);
  const sentTotals = {
    subtotal_cents: centsToDbValue(result.subtotalCents),
    discount_total_cents: centsToDbValue(result.discountTotalCents),
    tax_total_cents: centsToDbValue(result.taxTotalCents),
    total_cents: centsToDbValue(result.totalCents),
  };

  const { data: changeOrderRow, error: rpcError } = await supabase.rpc('send_change_order_for_acceptance', {
    p_change_order_id: params.changeOrderId,
    p_sent_line_items: sentLineItems,
    p_subtotal_cents: sentTotals.subtotal_cents,
    p_discount_total_cents: sentTotals.discount_total_cents,
    p_tax_total_cents: sentTotals.tax_total_cents,
    p_total_cents: sentTotals.total_cents,
  });

  if (rpcError) {
    throw new Error(`send_change_order_for_acceptance RPC failed for change order ${params.changeOrderId}: ${rpcError.message}`);
  }
  if (!changeOrderRow) {
    throw new Error(`send_change_order_for_acceptance RPC returned no row for change order ${params.changeOrderId}.`);
  }

  const changeOrder = mapChangeOrderRow(changeOrderRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'change_order.sent_for_acceptance',
    entityType: 'change_orders',
    entityId: params.changeOrderId,
    afterSummary: { totalCents: changeOrder.sentTotalCents === null ? null : changeOrder.sentTotalCents.toString() },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.sent_for_acceptance (change order ${params.changeOrderId}): ${auditError}`);
  }

  return { status: 'ok', changeOrder };
}

export interface ChangeOrderAcceptanceRecord {
  id: string;
  orgId: string;
  changeOrderId: string;
  snapshotHash: string;
  acceptedSnapshot: unknown;
  typedName: string;
  claimedAuthority: string;
  ip: string | null;
  userAgent: string | null;
  acceptedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAcceptanceRow(row: any): ChangeOrderAcceptanceRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    changeOrderId: row.change_order_id,
    snapshotHash: row.snapshot_hash,
    acceptedSnapshot: row.accepted_snapshot,
    typedName: row.typed_name,
    claimedAuthority: row.claimed_authority,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    acceptedAt: row.accepted_at,
  };
}

export interface RecordChangeOrderAcceptanceParams {
  orgId: string;
  changeOrderId: string;
  snapshotHash: string;
  acceptedSnapshot: unknown;
  typedName: string;
  claimedAuthority: string;
  ip?: string | null;
  userAgent?: string | null;
  externalActorId: string;
  externalActorLabel: string;
}

/**
 * Records an external client's acceptance of a sent change order. Same
 * trust-boundary contract as recordEstimateAcceptance() (see that
 * function's header comment in lib/quotes-payments/estimate-acceptances.ts,
 * not re-derived here): `supabase` MUST already be a service_role client
 * that has already passed a client-portal bearer-token check for this
 * change order -- `record_change_order_acceptance()`'s own grants
 * (`revoke all from public/authenticated; grant execute to service_role`
 * only) are the fail-closed backstop, not the primary control.
 */
export async function recordChangeOrderAcceptance(
  supabase: QPClient,
  params: RecordChangeOrderAcceptanceParams
): Promise<ChangeOrderAcceptanceRecord> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }

  const { data: row, error: rpcError } = await supabase.rpc('record_change_order_acceptance', {
    p_change_order_id: params.changeOrderId,
    p_snapshot_hash: params.snapshotHash,
    p_accepted_snapshot: params.acceptedSnapshot,
    p_typed_name: params.typedName,
    p_claimed_authority: params.claimedAuthority,
    p_ip: params.ip ?? null,
    p_user_agent: params.userAgent ?? null,
  });

  if (rpcError) {
    throw new Error(`record_change_order_acceptance RPC failed for change order ${params.changeOrderId}: ${rpcError.message}`);
  }
  if (!row) {
    throw new Error(`record_change_order_acceptance RPC returned no row for change order ${params.changeOrderId}.`);
  }

  const acceptance = mapAcceptanceRow(row);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    externalActorId: params.externalActorId,
    externalActorLabel: params.externalActorLabel,
    action: 'change_order.accepted',
    entityType: 'change_orders',
    entityId: acceptance.changeOrderId,
    afterSummary: {
      acceptanceId: acceptance.id,
      typedName: acceptance.typedName,
      claimedAuthority: acceptance.claimedAuthority,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.accepted (acceptance ${acceptance.id}): ${auditError}`);
  }

  return acceptance;
}

export interface IssueChangeOrderParams {
  orgId: string;
  changeOrderId: string;
  actorUserId: string;
  actorRole: Role;
}

/**
 * Calls `issue_change_order()`, which atomically creates a brand new DRAFT
 * invoice copying the change order's accepted delta line items -- this
 * wrapper does NOT itself issue that new invoice (no invoice_number is
 * assigned here); staff still calls issueInvoice() from invoices.ts
 * separately afterward, exactly like the RPC's own header comment
 * describes. Returns only the new draft invoice's id -- every caller in
 * this pass immediately navigates to/re-fetches that invoice by id to
 * render its own detail page, so returning the full InvoiceRecord shape
 * here would just be an unused duplicate of what invoices.ts's own
 * getInvoice()-equivalent read already provides.
 */
export async function issueChangeOrder(supabase: QPClient, params: IssueChangeOrderParams): Promise<{ id: string }> {
  await assertChangeOrdersEntitlement(params.orgId);

  const { data: invoiceRow, error: rpcError } = await supabase.rpc('issue_change_order', {
    p_change_order_id: params.changeOrderId,
  });

  if (rpcError) {
    throw new Error(`issue_change_order RPC failed for change order ${params.changeOrderId}: ${rpcError.message}`);
  }
  if (!invoiceRow) {
    throw new Error(`issue_change_order RPC returned no row for change order ${params.changeOrderId}.`);
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'change_order.issued',
    entityType: 'change_orders',
    entityId: params.changeOrderId,
    afterSummary: { resultingInvoiceId: invoiceRow.id },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.issued (change order ${params.changeOrderId}): ${auditError}`);
  }

  return { id: invoiceRow.id as string };
}

export interface VoidChangeOrderParams {
  orgId: string;
  changeOrderId: string;
  voidReason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/** Voids a not-yet-issued change order via `void_change_order()`. Also the mechanism staff use for "customer doesn't want this" -- see the migration's header comment on why no separate decline path exists. */
export async function voidChangeOrder(supabase: QPClient, params: VoidChangeOrderParams): Promise<ChangeOrderRecord> {
  await assertChangeOrdersEntitlement(params.orgId);

  const { data: changeOrderRow, error: rpcError } = await supabase.rpc('void_change_order', {
    p_change_order_id: params.changeOrderId,
    p_void_reason: params.voidReason ?? null,
  });

  if (rpcError) {
    throw new Error(`void_change_order RPC failed for change order ${params.changeOrderId}: ${rpcError.message}`);
  }
  if (!changeOrderRow) {
    throw new Error(`void_change_order RPC returned no row for change order ${params.changeOrderId}.`);
  }

  const changeOrder = mapChangeOrderRow(changeOrderRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'change_order.voided',
    entityType: 'change_orders',
    entityId: params.changeOrderId,
    afterSummary: { voidReason: params.voidReason ?? null },
  });
  if (auditError) {
    console.error(`Failed to write audit log for change_order.voided (change order ${params.changeOrderId}): ${auditError}`);
  }

  return changeOrder;
}
