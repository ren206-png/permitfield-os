// Gate 4 (Quotes & Payments), Phase A service layer -- thin wrapper around
// `record_estimate_acceptance()` (see
// supabase/migrations/20260806000053_estimate_acceptances.sql).
//
// TRUST BOUNDARY (read before calling this function from anywhere new):
// the migration's grants are `revoke all from public; revoke all from
// authenticated; grant execute to service_role` -- there is NO authenticated
// RLS/RPC path to this function at all, by design (an estimate is accepted
// by an external client via a client-portal link, not by an
// org-member-authenticated Supabase session; `estimate_acceptances` has no
// INSERT policy for `authenticated` either). That means the `supabase`
// client passed into `recordEstimateAcceptance()` below MUST already be a
// service_role client, and this function must only ever be called from a
// server-side context that has ALREADY, itself, validated a legitimate
// client-portal bearer token for this exact estimate/revision (the same
// token-validation step lib/bridge/client-portal.ts's `hashToken()` +
// token-lookup pattern performs for the existing client-portal surface --
// this module intentionally does not re-implement or replace that check).
// Concretely: the only correct caller shape is a Next.js Route Handler that
// (1) reads the client-portal bearer token from the request, (2) validates
// it against whatever token store backs it (out of scope for this pass --
// GATE_4_FINDINGS.md SS I notes the token system is "extended, not built in
// this pass"), (3) only THEN constructs a service_role Supabase client and
// calls this function. This module has no way to enforce that from inside
// itself -- passing it an `authenticated`-scoped client will simply fail at
// the RPC grant layer (Postgres will reject the call), which is a deliberate
// fail-closed backstop, not the primary control.
//
// The externalActorId/externalActorLabel audit-log shape (rather than
// actorUserId/actorRole) is used here because the acceptor is not an
// org-authenticated user -- same distinction lib/bridge/client-portal.ts
// already draws for its own external-actor audit entries, and mutually
// exclusive with the internal actor fields per the audit_log table's CHECK
// constraint (lib/audit/log.ts's own header comment).
import { writeAuditLog } from '@/lib/audit/log';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import type { QPClient } from './types';
import { pngBase64ToBytes, type SignatureSubmission } from '@/lib/esign/signature';
import type { EstimatePdfAcceptance } from '@/lib/pdf/estimate-pdf';
import { QuotesPaymentsDisabledError } from './estimates';

export interface EstimateAcceptanceRecord {
  id: string;
  orgId: string;
  estimateId: string;
  revisionId: string;
  revisionHash: string;
  acceptedScopeSnapshot: unknown;
  typedName: string;
  claimedAuthority: string;
  ip: string | null;
  userAgent: string | null;
  acceptedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAcceptanceRow(row: any): EstimateAcceptanceRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    estimateId: row.estimate_id,
    revisionId: row.revision_id,
    revisionHash: row.revision_hash,
    acceptedScopeSnapshot: row.accepted_scope_snapshot,
    typedName: row.typed_name,
    claimedAuthority: row.claimed_authority,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    acceptedAt: row.accepted_at,
  };
}

export interface RecordEstimateAcceptanceParams {
  orgId: string;
  revisionId: string;
  revisionHash: string;
  acceptedScopeSnapshot: unknown;
  typedName: string;
  claimedAuthority: string;
  ip?: string | null;
  userAgent?: string | null;
  externalActorId: string;
  externalActorLabel: string;
  signature: SignatureSubmission;
}

/**
 * Records an external client's acceptance of a sent estimate revision.
 * `supabase` MUST be a service_role client that has already passed a
 * client-portal bearer-token check for this revision -- see this file's
 * header comment for the full trust-boundary explanation; this function
 * performs no token validation of its own.
 *
 * `record_estimate_acceptance()` itself re-validates that `revisionId` is
 * still the estimate's `current_revision_id` (a stale-revision guard against
 * accepting a superseded quote) and raises a Postgres error
 * (`errcode = '22023'`) if not -- that error is propagated here as a thrown
 * Error, not swallowed, so the caller's route handler can turn it into a
 * "this quote has been superseded, please refresh" response rather than a
 * false "accepted."
 */
export async function recordEstimateAcceptance(
  supabase: QPClient,
  params: RecordEstimateAcceptanceParams
): Promise<EstimateAcceptanceRecord> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }

  const { data: row, error: rpcError } = await supabase.rpc('record_estimate_acceptance', {
    p_revision_id: params.revisionId,
    p_revision_hash: params.revisionHash,
    p_accepted_scope_snapshot: params.acceptedScopeSnapshot,
    p_typed_name: params.typedName,
    p_claimed_authority: params.claimedAuthority,
    p_ip: params.ip ?? null,
    p_user_agent: params.userAgent ?? null,
    p_esign_consent_text: params.signature.consentText,
    p_signature_method: params.signature.method,
    p_signature_png_base64: params.signature.pngBase64,
  });

  if (rpcError) {
    throw new Error(`record_estimate_acceptance RPC failed for revision ${params.revisionId}: ${rpcError.message}`);
  }
  if (!row) {
    throw new Error(`record_estimate_acceptance RPC returned no row for revision ${params.revisionId}.`);
  }

  const acceptance = mapAcceptanceRow(row);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    externalActorId: params.externalActorId,
    externalActorLabel: params.externalActorLabel,
    action: 'estimate.accepted',
    entityType: 'estimates',
    entityId: acceptance.estimateId,
    afterSummary: {
      acceptanceId: acceptance.id,
      revisionId: acceptance.revisionId,
      typedName: acceptance.typedName,
      claimedAuthority: acceptance.claimedAuthority,
      signatureMethod: params.signature.method,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for estimate.accepted (acceptance ${acceptance.id}): ${auditError}`);
  }

  return acceptance;
}

/**
 * Loads the acceptance (if any) of `revisionId` in the shape the estimate PDF
 * renders. Filters on both org and revision: the public PDF route calls this
 * with a service-role client and a token-verified orgId, where there is no RLS
 * to fall back on.
 */
export async function loadEstimateAcceptanceForPdf(
  supabase: QPClient,
  orgId: string,
  revisionId: string
): Promise<EstimatePdfAcceptance | null> {
  const { data, error } = await supabase
    .from('estimate_acceptances')
    .select('typed_name, claimed_authority, accepted_at, ip, revision_hash, signature_method, signature_png_base64, esign_consent_text')
    .eq('org_id', orgId)
    .eq('revision_id', revisionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load estimate acceptance for revision ${revisionId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return {
    typedName: data.typed_name,
    claimedAuthority: data.claimed_authority,
    acceptedAt: data.accepted_at,
    ip: data.ip ?? null,
    documentHash: data.revision_hash,
    signatureMethod: data.signature_method ?? null,
    signaturePng: data.signature_png_base64 ? pngBase64ToBytes(data.signature_png_base64) : null,
    esignConsentText: data.esign_consent_text ?? null,
  };
}
