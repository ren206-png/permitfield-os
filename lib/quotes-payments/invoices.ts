// Gate 4 (Quotes & Payments), Phase A service layer -- invoice lifecycle:
// draft creation (standalone or from an accepted estimate), draft line-item
// editing, `issue_invoice()` issuance, and `void_invoice()` (see
// supabase/migrations/20260806000047_invoices.sql for the full RPC/RLS
// contract this module wraps). Mirrors lib/quotes-payments/estimates.ts's
// shape deliberately -- same draft/immutable-snapshot split, same
// tax-then-RPC ordering, same audit-log discipline -- so the two lifecycle
// modules don't drift into different conventions for what is otherwise the
// same problem twice (see tax-result.ts's header comment on why this is a
// shared concern, not duplicated math).
import { createHash } from 'node:crypto';
import type { Role } from '@/lib/authz';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import type { TaxLineItemInput } from '@/lib/tax/types';
import { centsToDbValue, dbValueToCents, dbValueToCentsOrNull } from './db-mapping';
import { computeTaxOutcome, serializeLineItemBreakdowns, type QuotesPaymentsReviewReason } from './tax-result';
import type { LineItemDraftInput, LineItemRecord, QPClient } from './types';
import { QuotesPaymentsDisabledError, InsufficientEntitlementError } from './estimates';

async function assertInvoicesEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'invoices.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'invoices.manage');
  }
}

export type InvoiceStatus = 'draft' | 'issued' | 'void';

export interface InvoiceRecord {
  id: string;
  orgId: string;
  clientId: string;
  projectId: string | null;
  sourceEstimateId: string | null;
  status: InvoiceStatus;
  currencyCode: string;
  invoiceNumber: bigint | null;
  dueDate: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  scopeNotes: string | null;
  terms: string | null;
  subtotalCents: bigint | null;
  discountTotalCents: bigint | null;
  taxTotalCents: bigint | null;
  totalCents: bigint | null;
  issuedLineItems: unknown;
  issuedSubtotalCents: bigint | null;
  issuedDiscountTotalCents: bigint | null;
  issuedTaxTotalCents: bigint | null;
  issuedTotalCents: bigint | null;
  documentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInvoiceRow(row: any): InvoiceRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    projectId: row.project_id ?? null,
    sourceEstimateId: row.source_estimate_id ?? null,
    status: row.status,
    currencyCode: row.currency_code,
    invoiceNumber: row.invoice_number === null || row.invoice_number === undefined ? null : dbValueToCents(row.invoice_number),
    dueDate: row.due_date ?? null,
    issuedAt: row.issued_at ?? null,
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    scopeNotes: row.scope_notes ?? null,
    terms: row.terms ?? null,
    subtotalCents: dbValueToCentsOrNull(row.subtotal_cents),
    discountTotalCents: dbValueToCentsOrNull(row.discount_total_cents),
    taxTotalCents: dbValueToCentsOrNull(row.tax_total_cents),
    totalCents: dbValueToCentsOrNull(row.total_cents),
    issuedLineItems: row.issued_line_items ?? null,
    issuedSubtotalCents: dbValueToCentsOrNull(row.issued_subtotal_cents),
    issuedDiscountTotalCents: dbValueToCentsOrNull(row.issued_discount_total_cents),
    issuedTaxTotalCents: dbValueToCentsOrNull(row.issued_tax_total_cents),
    issuedTotalCents: dbValueToCentsOrNull(row.issued_total_cents),
    documentHash: row.document_hash ?? null,
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

function lineItemInsertPayload(orgId: string, invoiceId: string, lineItems: readonly LineItemDraftInput[]) {
  return lineItems.map((li, idx) => ({
    org_id: orgId,
    invoice_id: invoiceId,
    position: li.position ?? idx,
    description: li.description,
    quantity: li.quantity,
    unit_price_cents: centsToDbValue(li.unitPriceCents),
    discount_percent: li.discountPercent ?? null,
    discount_fixed_cents: centsToDbValue(li.discountFixedCents ?? null),
  }));
}

export interface CreateDraftInvoiceParams {
  orgId: string;
  clientId: string;
  projectId?: string | null;
  // Nullable: an invoice may be drafted directly from an accepted estimate
  // (carries the estimate's id forward for traceability) or entirely
  // standalone -- 20260806000047's own schema comment confirms this column
  // is nullable specifically to support the standalone case.
  sourceEstimateId?: string | null;
  dueDate?: string | null;
  scopeNotes?: string | null;
  terms?: string | null;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/** Creates a draft invoice + its initial line items. Ordinary RLS-enforced INSERTs, no RPC -- drafting is not a privileged action (same reasoning as createDraftEstimate()). */
export async function createDraftInvoice(supabase: QPClient, params: CreateDraftInvoiceParams): Promise<InvoiceRecord> {
  await assertInvoicesEntitlement(params.orgId);

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      project_id: params.projectId ?? null,
      source_estimate_id: params.sourceEstimateId ?? null,
      due_date: params.dueDate ?? null,
      scope_notes: params.scopeNotes ?? null,
      terms: params.terms ?? null,
      created_by: params.actorUserId,
    })
    .select()
    .single();

  if (invoiceError || !invoiceRow) {
    throw new Error(`Failed to create draft invoice: ${invoiceError?.message ?? 'no row returned'}`);
  }

  if (params.lineItems.length > 0) {
    const { error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .insert(lineItemInsertPayload(params.orgId, invoiceRow.id, params.lineItems));
    if (lineItemsError) {
      throw new Error(`Failed to create draft invoice line items for invoice ${invoiceRow.id}: ${lineItemsError.message}`);
    }
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'invoice.drafted',
    entityType: 'invoices',
    entityId: invoiceRow.id,
    afterSummary: {
      clientId: params.clientId,
      projectId: params.projectId ?? null,
      sourceEstimateId: params.sourceEstimateId ?? null,
      lineItemCount: params.lineItems.length,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for invoice.drafted (invoice ${invoiceRow.id}): ${auditError}`);
  }

  return mapInvoiceRow(invoiceRow);
}

export interface ReplaceDraftInvoiceLineItemsParams {
  orgId: string;
  invoiceId: string;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/** Replaces the full set of line items on a still-draft invoice (delete all, then insert the new set) -- same delete-then-insert semantics as replaceDraftEstimateLineItems(), for the same reason (RLS only permits either half while status = 'draft'). */
export async function replaceDraftInvoiceLineItems(
  supabase: QPClient,
  params: ReplaceDraftInvoiceLineItemsParams
): Promise<LineItemRecord[]> {
  await assertInvoicesEntitlement(params.orgId);

  const { error: deleteError } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('org_id', params.orgId)
    .eq('invoice_id', params.invoiceId);
  if (deleteError) {
    throw new Error(`Failed to clear existing line items for invoice ${params.invoiceId}: ${deleteError.message}`);
  }

  let insertedRows: LineItemRecord[] = [];
  if (params.lineItems.length > 0) {
    const { data, error: insertError } = await supabase
      .from('invoice_line_items')
      .insert(lineItemInsertPayload(params.orgId, params.invoiceId, params.lineItems))
      .select();
    if (insertError) {
      throw new Error(`Failed to insert replacement line items for invoice ${params.invoiceId}: ${insertError.message}`);
    }
    insertedRows = (data ?? []).map(mapLineItemRow);
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'invoice.line_items_updated',
    entityType: 'invoices',
    entityId: params.invoiceId,
    afterSummary: { lineItemCount: params.lineItems.length },
  });
  if (auditError) {
    console.error(`Failed to write audit log for invoice.line_items_updated (invoice ${params.invoiceId}): ${auditError}`);
  }

  return insertedRows;
}

export interface IssueInvoiceParams {
  orgId: string;
  invoiceId: string;
  actorUserId: string;
  actorRole: Role;
}

export type IssueInvoiceResult =
  | { status: 'ok'; invoice: InvoiceRecord }
  | { status: 'review_required'; reason: QuotesPaymentsReviewReason; message: string };

/**
 * Locks in the immutable issued_* snapshot by calling `issue_invoice()`.
 * Same tax-before-RPC ordering as sendEstimate(): loads the invoice's
 * current draft line items, resolves the org's tax profile, runs
 * calculateTax(), and only calls the RPC on an `'ok'` tax outcome. The
 * issued snapshot's `document_hash` is a sha256 of the exact jsonb payload
 * handed to the RPC (deterministic JSON.stringify of the serialized
 * breakdown array plus the four totals, all cents already converted to
 * plain numbers via serializeLineItemBreakdowns()/centsToDbValue() so the
 * hash input has no BigInt in it) -- the same "second independent proof of
 * what was issued" reasoning the migration's own header comment gives for
 * this column, computed here (in the application layer) rather than in SQL
 * per this gate's "no calculation logic in SQL" rule, using the same
 * `createHash('sha256')` pattern lib/storage/documents.ts's
 * `computeSha256()` and lib/bridge/client-portal.ts's `hashToken()` already
 * establish for this codebase's content-hashing convention.
 */
export async function issueInvoice(supabase: QPClient, params: IssueInvoiceParams): Promise<IssueInvoiceResult> {
  await assertInvoicesEntitlement(params.orgId);

  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from('invoice_line_items')
    .select('id, description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
    .eq('org_id', params.orgId)
    .eq('invoice_id', params.invoiceId)
    .order('position', { ascending: true });

  if (lineItemsError) {
    throw new Error(`Failed to load line items for invoice ${params.invoiceId}: ${lineItemsError.message}`);
  }
  if (!lineItemRows || lineItemRows.length === 0) {
    throw new Error(`Invoice ${params.invoiceId} has no line items; cannot issue an empty invoice.`);
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
  const issuedLineItems = serializeLineItemBreakdowns(result.lineItems);
  const issuedTotals = {
    subtotal_cents: centsToDbValue(result.subtotalCents),
    discount_total_cents: centsToDbValue(result.discountTotalCents),
    tax_total_cents: centsToDbValue(result.taxTotalCents),
    total_cents: centsToDbValue(result.totalCents),
  };
  const documentHash = createHash('sha256')
    .update(JSON.stringify({ lineItems: issuedLineItems, totals: issuedTotals }), 'utf8')
    .digest('hex');

  const { data: invoiceRow, error: rpcError } = await supabase.rpc('issue_invoice', {
    p_invoice_id: params.invoiceId,
    p_issued_line_items: issuedLineItems,
    p_subtotal_cents: issuedTotals.subtotal_cents,
    p_discount_total_cents: issuedTotals.discount_total_cents,
    p_tax_total_cents: issuedTotals.tax_total_cents,
    p_total_cents: issuedTotals.total_cents,
    p_document_hash: documentHash,
  });

  if (rpcError) {
    throw new Error(`issue_invoice RPC failed for invoice ${params.invoiceId}: ${rpcError.message}`);
  }
  if (!invoiceRow) {
    throw new Error(`issue_invoice RPC returned no row for invoice ${params.invoiceId}.`);
  }

  const invoice = mapInvoiceRow(invoiceRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'invoice.issued',
    entityType: 'invoices',
    entityId: params.invoiceId,
    afterSummary: {
      invoiceNumber: invoice.invoiceNumber === null ? null : invoice.invoiceNumber.toString(),
      totalCents: invoice.issuedTotalCents === null ? null : invoice.issuedTotalCents.toString(),
      documentHash,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for invoice.issued (invoice ${params.invoiceId}): ${auditError}`);
  }

  return { status: 'ok', invoice };
}

export interface VoidInvoiceParams {
  orgId: string;
  invoiceId: string;
  voidReason?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/** Voids an issued invoice via `void_invoice()`. Never reclaims the invoice_number (see migration header comment) -- the RPC itself enforces that, this wrapper just calls it and audit-logs the result. */
export async function voidInvoice(supabase: QPClient, params: VoidInvoiceParams): Promise<InvoiceRecord> {
  await assertInvoicesEntitlement(params.orgId);

  const { data: invoiceRow, error: rpcError } = await supabase.rpc('void_invoice', {
    p_invoice_id: params.invoiceId,
    p_void_reason: params.voidReason ?? null,
  });

  if (rpcError) {
    throw new Error(`void_invoice RPC failed for invoice ${params.invoiceId}: ${rpcError.message}`);
  }
  if (!invoiceRow) {
    throw new Error(`void_invoice RPC returned no row for invoice ${params.invoiceId}.`);
  }

  const invoice = mapInvoiceRow(invoiceRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'invoice.voided',
    entityType: 'invoices',
    entityId: params.invoiceId,
    afterSummary: { voidReason: params.voidReason ?? null },
  });
  if (auditError) {
    console.error(`Failed to write audit log for invoice.voided (invoice ${params.invoiceId}): ${auditError}`);
  }

  return invoice;
}
