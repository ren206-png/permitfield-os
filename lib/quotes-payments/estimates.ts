// Gate 4 (Quotes & Payments), Phase A service layer -- estimate (quote)
// lifecycle: draft creation, draft line-item editing, and `send_estimate()`
// issuance (see supabase/migrations/20260806000045_estimates.sql for the
// full RPC/RLS contract this module wraps).
//
// Every exported function here is gated behind isQuotesPaymentsEnabled()
// (lib/flags.ts) as its first line, matching this codebase's "declared
// ahead of its consumer" / "flag gates the application-layer entry point,
// not the table's existence" convention every other PERMITFIELD_FF_* flag
// in this file already follows -- see lib/flags.ts's own header comment on
// isQuotesPaymentsEnabled(). A caller with the flag off gets a thrown
// QuotesPaymentsDisabledError before any DB call, same "fail toward the
// disabled state" posture as every other flag-gated module.
import type { Role } from '@/lib/authz';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import type { TaxLineItemInput } from '@/lib/tax/types';
import { centsToDbValue, dbValueToCents, dbValueToCentsOrNull } from './db-mapping';
import { computeTaxOutcome, serializeLineItemBreakdowns, type QuotesPaymentsReviewReason } from './tax-result';
import type { LineItemDraftInput, LineItemRecord, QPClient } from './types';

export class QuotesPaymentsDisabledError extends Error {
  constructor() {
    super('Quotes & Payments module is disabled (PERMITFIELD_FF_QUOTES_PAYMENTS is not "true").');
    this.name = 'QuotesPaymentsDisabledError';
  }
}

export class InsufficientEntitlementError extends Error {
  constructor(orgId: string, entitlement: string) {
    super(`Org ${orgId} does not have the "${entitlement}" entitlement.`);
    this.name = 'InsufficientEntitlementError';
  }
}

async function assertQuotesEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'quotes.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'quotes.manage');
  }
}

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';

export interface EstimateRecord {
  id: string;
  orgId: string;
  clientId: string;
  projectId: string | null;
  status: EstimateStatus;
  currencyCode: string;
  expiryDate: string | null;
  scopeNotes: string | null;
  exclusions: string | null;
  terms: string | null;
  currentRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateRevisionRecord {
  id: string;
  orgId: string;
  estimateId: string;
  revisionNumber: number;
  sentAt: string;
  currencyCode: string;
  expiryDate: string | null;
  scopeNotes: string | null;
  exclusions: string | null;
  terms: string | null;
  lineItems: unknown;
  subtotalCents: bigint;
  discountTotalCents: bigint;
  taxTotalCents: bigint;
  totalCents: bigint;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEstimateRow(row: any): EstimateRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    projectId: row.project_id ?? null,
    status: row.status,
    currencyCode: row.currency_code,
    expiryDate: row.expiry_date ?? null,
    scopeNotes: row.scope_notes ?? null,
    exclusions: row.exclusions ?? null,
    terms: row.terms ?? null,
    currentRevisionId: row.current_revision_id ?? null,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRevisionRow(row: any): EstimateRevisionRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    estimateId: row.estimate_id,
    revisionNumber: row.revision_number,
    sentAt: row.sent_at,
    currencyCode: row.currency_code,
    expiryDate: row.expiry_date ?? null,
    scopeNotes: row.scope_notes ?? null,
    exclusions: row.exclusions ?? null,
    terms: row.terms ?? null,
    lineItems: row.line_items,
    subtotalCents: dbValueToCents(row.subtotal_cents),
    discountTotalCents: dbValueToCents(row.discount_total_cents),
    taxTotalCents: dbValueToCents(row.tax_total_cents),
    totalCents: dbValueToCents(row.total_cents),
  };
}

function lineItemInsertPayload(orgId: string, estimateId: string, lineItems: readonly LineItemDraftInput[]) {
  return lineItems.map((li, idx) => ({
    org_id: orgId,
    estimate_id: estimateId,
    position: li.position ?? idx,
    description: li.description,
    quantity: li.quantity,
    unit_price_cents: centsToDbValue(li.unitPriceCents),
    discount_percent: li.discountPercent ?? null,
    discount_fixed_cents: centsToDbValue(li.discountFixedCents ?? null),
  }));
}

export interface CreateDraftEstimateParams {
  orgId: string;
  clientId: string;
  projectId?: string | null;
  expiryDate?: string | null;
  scopeNotes?: string | null;
  exclusions?: string | null;
  terms?: string | null;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/** Creates a draft estimate + its initial line items in one call. Both writes are ordinary RLS-enforced INSERTs (no RPC needed -- drafting is not a privileged action, see 20260806000045's own policy comments). */
export async function createDraftEstimate(supabase: QPClient, params: CreateDraftEstimateParams): Promise<EstimateRecord> {
  await assertQuotesEntitlement(params.orgId);

  const { data: estimateRow, error: estimateError } = await supabase
    .from('estimates')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      project_id: params.projectId ?? null,
      expiry_date: params.expiryDate ?? null,
      scope_notes: params.scopeNotes ?? null,
      exclusions: params.exclusions ?? null,
      terms: params.terms ?? null,
      created_by: params.actorUserId,
    })
    .select()
    .single();

  if (estimateError || !estimateRow) {
    throw new Error(`Failed to create draft estimate: ${estimateError?.message ?? 'no row returned'}`);
  }

  if (params.lineItems.length > 0) {
    const { error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .insert(lineItemInsertPayload(params.orgId, estimateRow.id, params.lineItems));
    if (lineItemsError) {
      throw new Error(`Failed to create draft estimate line items for estimate ${estimateRow.id}: ${lineItemsError.message}`);
    }
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'estimate.drafted',
    entityType: 'estimates',
    entityId: estimateRow.id,
    afterSummary: { clientId: params.clientId, projectId: params.projectId ?? null, lineItemCount: params.lineItems.length },
  });
  if (auditError) {
    console.error(`Failed to write audit log for estimate.drafted (estimate ${estimateRow.id}): ${auditError}`);
  }

  return mapEstimateRow(estimateRow);
}

export interface ReplaceDraftEstimateLineItemsParams {
  orgId: string;
  estimateId: string;
  lineItems: LineItemDraftInput[];
  actorUserId: string;
  actorRole: Role;
}

/**
 * Replaces the full set of line items on a still-draft estimate (delete
 * all, then insert the new set) -- the simplest correct semantics for
 * "update draft line items" given the RLS policies only ever allow this
 * while `status = 'draft'` (20260806000045_estimates.sql); an estimate that
 * has already been sent will fail both the delete and the insert at the
 * RLS layer, surfacing as a thrown Postgres error here rather than a
 * partial, silently-ignored write.
 */
export async function replaceDraftEstimateLineItems(
  supabase: QPClient,
  params: ReplaceDraftEstimateLineItemsParams
): Promise<LineItemRecord[]> {
  await assertQuotesEntitlement(params.orgId);

  const { error: deleteError } = await supabase
    .from('estimate_line_items')
    .delete()
    .eq('org_id', params.orgId)
    .eq('estimate_id', params.estimateId);
  if (deleteError) {
    throw new Error(`Failed to clear existing line items for estimate ${params.estimateId}: ${deleteError.message}`);
  }

  let insertedRows: LineItemRecord[] = [];
  if (params.lineItems.length > 0) {
    const { data, error: insertError } = await supabase
      .from('estimate_line_items')
      .insert(lineItemInsertPayload(params.orgId, params.estimateId, params.lineItems))
      .select();
    if (insertError) {
      throw new Error(`Failed to insert replacement line items for estimate ${params.estimateId}: ${insertError.message}`);
    }
    insertedRows = (data ?? []).map(mapLineItemRow);
  }

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'estimate.line_items_updated',
    entityType: 'estimates',
    entityId: params.estimateId,
    afterSummary: { lineItemCount: params.lineItems.length },
  });
  if (auditError) {
    console.error(`Failed to write audit log for estimate.line_items_updated (estimate ${params.estimateId}): ${auditError}`);
  }

  return insertedRows;
}

export interface SendEstimateParams {
  orgId: string;
  estimateId: string;
  actorUserId: string;
  actorRole: Role;
}

export type SendEstimateResult =
  | { status: 'ok'; revision: EstimateRevisionRecord }
  | { status: 'review_required'; reason: QuotesPaymentsReviewReason; message: string };

/**
 * Locks in a versioned, immutable snapshot of a draft estimate by calling
 * `send_estimate()`. Reads the org's org_tax_profiles row itself (via
 * computeTaxOutcome()/resolveOrgTaxContext() -- never assumes one exists)
 * and calls calculateTax() BEFORE the RPC, exactly matching this gate's
 * "no calculation logic in SQL, totals are computed here and passed in
 * already-computed" contract (20260806000045's own header comment). A
 * `'review_required'` tax outcome (missing profile, unsupported province,
 * unknown registration status) is returned to the caller as a typed result
 * -- `send_estimate()` is never called in that case, so no state changes
 * and no audit-log entry is written for it; only a genuine send writes the
 * `estimate.sent` audit entry.
 */
export async function sendEstimate(supabase: QPClient, params: SendEstimateParams): Promise<SendEstimateResult> {
  await assertQuotesEntitlement(params.orgId);

  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from('estimate_line_items')
    .select('id, description, quantity, unit_price_cents, discount_percent, discount_fixed_cents')
    .eq('org_id', params.orgId)
    .eq('estimate_id', params.estimateId)
    .order('position', { ascending: true });

  if (lineItemsError) {
    throw new Error(`Failed to load line items for estimate ${params.estimateId}: ${lineItemsError.message}`);
  }
  if (!lineItemRows || lineItemRows.length === 0) {
    throw new Error(`Estimate ${params.estimateId} has no line items; cannot send an empty estimate.`);
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
  const { data: revisionRow, error: rpcError } = await supabase.rpc('send_estimate', {
    p_estimate_id: params.estimateId,
    p_subtotal_cents: centsToDbValue(result.subtotalCents),
    p_discount_total_cents: centsToDbValue(result.discountTotalCents),
    p_tax_total_cents: centsToDbValue(result.taxTotalCents),
    p_total_cents: centsToDbValue(result.totalCents),
    p_line_items: serializeLineItemBreakdowns(result.lineItems),
  });

  if (rpcError) {
    throw new Error(`send_estimate RPC failed for estimate ${params.estimateId}: ${rpcError.message}`);
  }
  if (!revisionRow) {
    throw new Error(`send_estimate RPC returned no row for estimate ${params.estimateId}.`);
  }

  const revision = mapRevisionRow(revisionRow);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'estimate.sent',
    entityType: 'estimates',
    entityId: params.estimateId,
    afterSummary: {
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      totalCents: revision.totalCents.toString(),
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for estimate.sent (estimate ${params.estimateId}): ${auditError}`);
  }

  return { status: 'ok', revision };
}
