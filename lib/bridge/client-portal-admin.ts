import { randomBytes, createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClientPortalServiceClient } from '@/lib/supabase/client-portal-service-client';
import { writeAuditLog } from '@/lib/audit/log';
import type { Role } from '@/lib/authz';

// Gate 2.0 sub-phase 2.6 (GATE_2_0_SPEC.md §7 item 2; scoped and reviewed in
// GATE_2_0_FINDINGS.md §O before this branch, approved as "APPROVED: PHASE
// 2.6"). The staff-facing sibling of lib/bridge/client-portal.ts.
//
// Why a separate module rather than adding issueToken/revokeToken to
// client-portal.ts (§O.2, decided): that file's own header states it is
// "the entire enumerated operation set §3 defines" -- true only as long as
// every operation it holds is one of §3's six client-facing, token-
// authorized reads. Issuance and revocation are staff-facing and
// org-membership-authorized instead (§1's transition matrix: issuance is
// "invoked from the main app, not from the client portal"). Adding them to
// that file would make its own docstring false the moment they landed, the
// same class of defect the writeAuditLog() "first call site" drift already
// demonstrated once in this codebase (see below, and this file's own fix
// to that same drift in lib/audit/log.ts's header). A third, cheap
// allow-list entry in eslint.config.mjs is a better trade than a stale
// claim about what a security-boundary module contains.
//
// Import boundary: same mechanism as lib/bridge/client-portal.ts -- this
// file (and its own live test file, client-portal-admin.live.test.ts) is
// explicitly allow-listed in eslint.config.mjs's no-restricted-imports
// rule as one of the only files permitted to import
// lib/supabase/client-portal-service-client.ts.
//
// Authorization model, deliberately different from client-portal.ts's: a
// client-portal operation is authorized by possession of a valid token
// (project 2). A staff operation here is authorized by org membership
// (project 1, via the two narrow RPC functions this sub-phase's migration
// adds -- can_issue_client_access_token / can_revoke_client_access_token,
// 20260806000033) -- checked with a SESSION-SCOPED project-1 client
// (lib/supabase/server.ts's createClient()), never service-role, so the
// check runs as the actual calling user and Postgres itself (not app-layer
// trust) is what enforces `auth.uid()`-scoped membership. That same
// session-scoped client is also the one used for this file's audit_logs
// writes below, for the identical RLS reason writeAuditLog()'s own header
// documents (audit_logs_insert requires `actor_user_id = auth.uid()`,
// which only holds for a real user session, never a service-role client).
// Only the actual client_access_tokens/token_lifecycle_events writes use
// project 2's service-role client (createClientPortalServiceClient()) --
// project 2 has no staff-authenticated role of its own to authorize
// against (§4's guarantees-comparison section).
//
// Two callers, each getting exactly the tier §O.1 decided, not a shared
// one: issuance (owner, org_owner) is narrower than revocation (owner,
// org_owner, permit_manager) -- a permit_manager may need to shut off a
// client's access without also being trusted to mint new access.
//
// TTL: 7 days, set explicitly at issuance time below (never a column
// DEFAULT -- client_access_tokens.expires_at has none, confirmed against
// the live migration), superseding §1's own previously-proposed 14 --
// GATE_2_0_SPEC.md §1 is corrected to say 7 in this same branch.

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  // Same algorithm, same "no per-row salt" reasoning as
  // lib/bridge/client-portal.ts's own hashToken() (that file's header on
  // this exact point) -- the bearer token is a high-entropy random string,
  // not a low-entropy secret a rainbow table could target, so a salt adds
  // no real resistance. Not imported from that file: client-portal.ts
  // exports nothing (every helper there is module-private), and this is a
  // three-line pure function, not worth widening that file's exports for.
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function generateRawToken(): string {
  // 32 bytes (256 bits) of CSPRNG output, base64url-encoded -- URL-safe
  // without escaping, so this can be dropped directly into a magic-link
  // path/query segment by whichever future route/Server Action calls
  // issueToken (no route exists yet -- §O.7 confirmed 2.6 adds no new
  // reachable route; that is 2.7's job).
  return randomBytes(32).toString('base64url');
}

type PortalClient = ReturnType<typeof createClientPortalServiceClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionClient = SupabaseClient<any>;

export interface IssueTokenParams {
  orgId: string;
  applicationId: string;
  recipientEmailDisplay: string;
  recipientName?: string | null;
  actorUserId: string;
  actorRole: Role;
}

export interface IssueTokenResult {
  tokenId: string;
  // The raw bearer credential -- present only when this call actually
  // minted it. Null when this call lost the first-issuance §1 race and is
  // instead returning the identity of the token the OTHER, concurrent
  // caller just created: the raw secret was never known outside that other
  // invocation's own stack frame (client_access_tokens stores only its
  // hash, by design -- see §1/hashToken() above), so there is no value to
  // hand back here, ever. Callers must treat `rawToken: null` as "a token
  // exists and is active for this recipient, but this call did not
  // generate a fresh magic-link to send" -- not an error, per §1's own
  // "the caller should get back 'here is the active token,' not a 500."
  rawToken: string | null;
  expiresAt: string;
  wasCreated: boolean;
}

export interface StaffBridgeResult<T> {
  data: T | null;
  error: string | null;
}

// Issuance (§O.1: owner, org_owner). Mirrors app/(app)/projects/new/actions.ts's
// own `writeAuditLog(supabase, ...)` call shape -- `supabase` here is the
// same session-scoped client the caller already holds (this function does
// not create its own project-1 client, unlike client-portal.ts's
// operations, which have no session to reuse).
export async function issueToken(
  supabase: SessionClient,
  params: IssueTokenParams
): Promise<StaffBridgeResult<IssueTokenResult>> {
  const { data: authorized, error: authError } = await supabase.rpc('can_issue_client_access_token', {
    check_org_id: params.orgId,
  });
  if (authError) {
    return { data: null, error: `Authorization check failed: ${authError.message}` };
  }
  if (!authorized) {
    return { data: null, error: 'not_authorized' };
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const portal: PortalClient = createClientPortalServiceClient();
  const { data: rows, error: rpcError } = await portal.rpc('issue_client_access_token', {
    p_org_id: params.orgId,
    p_application_id: params.applicationId,
    p_recipient_email_display: params.recipientEmailDisplay,
    p_recipient_name: params.recipientName ?? null,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
    p_triggered_by_org_user_id: params.actorUserId,
  });

  if (rpcError) {
    return { data: null, error: `Token issuance failed: ${rpcError.message}` };
  }
  const row = rows?.[0];
  if (!row) {
    return { data: null, error: 'Token issuance returned no row.' };
  }

  // audit_logs write (§O.6, decided: yes, on both issue and revoke).
  // token_lifecycle_events (just written, inside issue_client_access_token's
  // own transaction) records the token's own state machine;  audit_logs
  // records that THIS staff member performed THIS action -- written every
  // time this function is called and authorized, including the
  // wasCreated=false race-loser case: the staff member's own action was
  // still "request a token for this recipient," and the outcome
  // (created vs. an already-active one returned) is captured in
  // afterSummary rather than silently dropping the log entry for that case.
  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'client_access_token.issued',
    entityType: 'client_access_tokens',
    entityId: row.token_id,
    afterSummary: {
      applicationId: params.applicationId,
      recipientEmailDisplay: params.recipientEmailDisplay,
      expiresAt: row.expires_at,
      wasCreated: row.was_created,
    },
  });
  if (auditError) {
    console.error(
      `[lib/bridge/client-portal-admin] writeAuditLog failed for client_access_token.issued (token ${row.token_id}): ${auditError}`
    );
  }

  return {
    data: {
      tokenId: row.token_id,
      rawToken: row.was_created ? rawToken : null,
      expiresAt: row.expires_at,
      wasCreated: row.was_created,
    },
    error: null,
  };
}

export interface RevokeResult {
  revoked: boolean;
  tokenId: string | null;
  applicationId: string | null;
}

interface RevokeAuditContext {
  orgId: string;
  actorUserId: string;
  actorRole: Role;
}

async function writeRevocationAudit(
  supabase: SessionClient,
  ctx: RevokeAuditContext,
  tokenId: string,
  applicationId: string
): Promise<void> {
  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'client_access_token.revoked',
    entityType: 'client_access_tokens',
    entityId: tokenId,
    afterSummary: { applicationId },
  });
  if (auditError) {
    console.error(
      `[lib/bridge/client-portal-admin] writeAuditLog failed for client_access_token.revoked (token ${tokenId}): ${auditError}`
    );
  }
}

// Per-token revocation (§1: "UPDATE ... WHERE id = :token_id"). Revocation
// tier (§O.1: owner, org_owner, permit_manager) is deliberately wider than
// issuance's.
export async function revokeTokenById(
  supabase: SessionClient,
  params: { orgId: string; tokenId: string; actorUserId: string; actorRole: Role }
): Promise<StaffBridgeResult<RevokeResult>> {
  const { data: authorized, error: authError } = await supabase.rpc('can_revoke_client_access_token', {
    check_org_id: params.orgId,
  });
  if (authError) {
    return { data: null, error: `Authorization check failed: ${authError.message}` };
  }
  if (!authorized) {
    return { data: null, error: 'not_authorized' };
  }

  const portal: PortalClient = createClientPortalServiceClient();
  const { data: rows, error: rpcError } = await portal.rpc('revoke_client_access_token_by_id', {
    p_token_id: params.tokenId,
    p_org_id: params.orgId,
    p_triggered_by_org_user_id: params.actorUserId,
  });

  if (rpcError) {
    return { data: null, error: `Token revocation failed: ${rpcError.message}` };
  }

  const row = rows?.[0];
  if (!row) {
    // Nothing to revoke -- already revoked/expired/superseded, the id
    // doesn't exist, or (the SQL function's own org_id filter) it belongs
    // to a different org than the caller's. Not an error: same "a denied
    // or already-terminal state is a legitimate outcome, not a 500"
    // discipline §1/§3 apply throughout this bridge layer.
    return { data: { revoked: false, tokenId: null, applicationId: null }, error: null };
  }

  await writeRevocationAudit(supabase, params, row.token_id, row.application_id);

  return { data: { revoked: true, tokenId: row.token_id, applicationId: row.application_id }, error: null };
}

// Per-recipient revocation (§1: "UPDATE ... WHERE recipient_email = :email
// AND application_id = :app_id AND status = 'active'").
export async function revokeTokenForRecipient(
  supabase: SessionClient,
  params: {
    orgId: string;
    applicationId: string;
    recipientEmail: string;
    actorUserId: string;
    actorRole: Role;
  }
): Promise<StaffBridgeResult<RevokeResult>> {
  const { data: authorized, error: authError } = await supabase.rpc('can_revoke_client_access_token', {
    check_org_id: params.orgId,
  });
  if (authError) {
    return { data: null, error: `Authorization check failed: ${authError.message}` };
  }
  if (!authorized) {
    return { data: null, error: 'not_authorized' };
  }

  const portal: PortalClient = createClientPortalServiceClient();
  const { data: rows, error: rpcError } = await portal.rpc('revoke_client_access_token_for_recipient', {
    p_application_id: params.applicationId,
    p_org_id: params.orgId,
    p_recipient_email: params.recipientEmail,
    p_triggered_by_org_user_id: params.actorUserId,
  });

  if (rpcError) {
    return { data: null, error: `Token revocation failed: ${rpcError.message}` };
  }

  const row = rows?.[0];
  if (!row) {
    return { data: { revoked: false, tokenId: null, applicationId: null }, error: null };
  }

  await writeRevocationAudit(supabase, params, row.token_id, row.application_id);

  return { data: { revoked: true, tokenId: row.token_id, applicationId: row.application_id }, error: null };
}
