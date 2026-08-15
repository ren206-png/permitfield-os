import { createHash } from 'crypto';
import { createClientPortalServiceClient } from '@/lib/supabase/client-portal-service-client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isAllowedMimeType, MAX_FILE_SIZE_BYTES, UPLOADS_BUCKET, buildStoragePath, computeSha256 } from '@/lib/storage/documents';
import { isClientPortalEnabled } from '@/lib/flags';
import { writeAuditLog } from '@/lib/audit/log';

// Gate 2.0 sub-phase 2.4 (GATE_2_0_SPEC.md §3), extended by sub-phase 2.5.
// The client-portal bridge layer: the ONLY module in this repo permitted to
// hold both projects' service-role credentials side by side and read across
// them. This file is the entire enumerated operation set §3 defines: the
// five read operations from 2.4, plus `uploadDocument` (2.5) -- each a
// specific, narrow, hand-written projection, never a passthrough query.
//
// Import boundary: eslint.config.mjs's no-restricted-imports rule is the
// only file in the repo permitted to import
// lib/supabase/client-portal-service-client.ts. See that module's header
// and GATE_2_0_SPEC.md §3's "Current status of the two mechanisms
// (K.5/L.1)" note -- this lint rule is the ENTIRE enforced boundary today,
// not one of two independent layers, since credential physical isolation
// has no deploy target to attach to yet.
//
// Every operation below collapses every non-success case into the same
// generic `{ error: 'link_unavailable' }` (§3's "Failure mode" section) --
// a recipient holding a stale link and one whose access was explicitly
// revoked see an identical response. The distinguishing detail is not
// discarded, only kept out of the response: every attempt (found or not,
// success or denied) writes a project-2 `client_access_log` row via
// logAttempt() below.
//
// Feature flag (GATE_2_0_FINDINGS.md §M.4 decision, sub-phase 2.5): every
// exported operation below -- all five 2.4 read operations, and
// `uploadDocument` -- now starts with an `isClientPortalEnabled()` check,
// before anything else runs, including before `createClientPortalServiceClient()`
// is ever called. `isClientPortalEnabled()` (`lib/flags.ts`) had zero call
// sites from 2.4 through the start of 2.5 -- an "inert flag" the user
// flagged as unfinished business dating back to Gate 1.7, on a flag whose
// own 2.4 header comment already claimed "leaving it off is what keeps the
// second project's service-role credential... unreachable from any live
// request until this is explicitly turned on," a claim that was not
// actually true until this change. This also brings the implementation in
// line with GATE_2_0_SPEC.md §6's own sub-phase table, which already
// described both 2.4 and 2.5 as "flag-gated" before either was.
//
// Deliberately no `client_access_log` write for the disabled case: unlike
// every other denial path below, a disabled flag means this function
// returns before `createClientPortalServiceClient()` is ever called, so
// project 2 is never touched at all when the flag is off -- not even to
// log the attempt. That is the literal meaning of "unreachable," not an
// oversight.

const SIGNED_URL_TTL_SECONDS = 300; // Matches the existing convention (app/(app)/applications/[id]/page.tsx's
// own page-local SIGNED_URL_TTL_SECONDS constant, ≤15 min per the master
// prompt §3.6/Phase 0 §M convention §3's own table cites). GATE_2_0_FINDINGS.md
// §L.2 flagged that constant has no shared/exported home to import from --
// duplicated here rather than reaching into an unrelated page component,
// a small implementation decision L.2 explicitly left to 2.4, not a schema gap.

export type BridgeErrorResponse = { error: 'link_unavailable' };

// The granular reason every denial actually happened, written only to
// `client_access_log.detail` (§3's failure-mode section) -- never returned
// to the caller. Plain `text` column, not a DB enum, so this union is a
// TypeScript-side discipline only; new reasons can be added here without a
// migration.
type DenialDetail =
  | 'token_not_found'
  | 'token_expired'
  | 'token_revoked'
  | 'token_superseded'
  | 'application_not_found'
  | 'document_not_found'
  | 'document_archived'
  // uploadDocument only (sub-phase 2.5): the two rejections §6(a) requires
  // happen before any DB write, mirroring app/api/documents/route.ts's own
  // ordering.
  | 'invalid_mime_type'
  | 'file_too_large'
  // uploadDocument only: the Storage upload or application_documents insert
  // itself failed for a reason other than the legitimate "already exists"
  // re-submission case (which is not a denial at all -- see uploadDocument's
  // own comment).
  | 'upload_failed';

// Optional request metadata a future route handler can supply for the
// `client_access_log.ip`/`user_agent` columns. Deliberately NOT part of any
// operation's authorization surface (§3: "no operation accepts an arbitrary
// application_id/org_id parameter from the caller") -- these two fields are
// audit context only, never consulted by any authorization check below.
export type BridgeRequestContext = {
  ip?: string;
  userAgent?: string;
};

type ClientPortalClient = ReturnType<typeof createClientPortalServiceClient>;
type MainProjectClient = ReturnType<typeof createServiceClient>;

// The bearer credential is never stored, only its hash (§2's own words on
// `client_access_tokens.token_hash`) -- "hash the presented token, look up
// by hash, check status/expiry," identical in shape to a password-hash
// check. §2 describes `token_hash` as carrying "a salted hash," but no
// per-row salt column exists on `client_access_tokens` (confirmed by direct
// read of 20260814000001), and token issuance is explicitly out of scope
// for 2.4 (§3's own operation table: issuance is "a staff-facing operation
// not enumerated in §3's client-facing operation set"). No prior spec
// text pins a concrete algorithm, so this is decided here, for both this
// lookup and whichever future issuance code writes `token_hash`: a plain
// SHA-256 hex digest of the raw token. A per-row salt defends against
// precomputed rainbow-table attacks on LOW-entropy secrets (e.g. user
// passwords); the bearer token here is "a high-entropy random string
// generated at issue time" (§0's own description) -- salting a
// high-entropy random value adds no real resistance a plain hash doesn't
// already have, so this keeps the lookup a single deterministic index
// hit (`unique (token_hash)`, §2) rather than a per-row-salted scan.
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// Writes one `client_access_log` row for every invocation, success or
// denied (§4's guarantees-comparison section: "every token-driven access,
// resolved or not, successful or denied" stays in this one ledger).
// `tokenId` is null exactly for the pre-resolution case (hash lookup found
// no row) -- the only case `client_access_log.token_id`'s NOT NULL was
// dropped for (migration 20260815000001, discovered while writing this
// function).
//
// A logging failure must never mask or throw over the caller's already-
// computed result -- this function swallows its own insert error after
// reporting it, rather than propagating it into resolveToken()'s (etc.) own
// control flow. The alternative (letting a `client_access_log` outage turn
// every bridge call into a 500) would make the accountability ledger a
// single point of failure for the read path it is only supposed to
// observe, not gate.
async function logAttempt(
  portal: ClientPortalClient,
  args: {
    tokenId: string | null;
    operation: string;
    resourceType?: string | null;
    resourceId?: string | null;
    outcome: 'success' | 'denied';
    detail?: DenialDetail | null;
    context?: BridgeRequestContext;
  }
): Promise<void> {
  const { error } = await portal.from('client_access_log').insert({
    token_id: args.tokenId,
    operation: args.operation,
    resource_type: args.resourceType ?? null,
    resource_id: args.resourceId ?? null,
    outcome: args.outcome,
    detail: args.outcome === 'denied' ? (args.detail ?? null) : null,
    ip: args.context?.ip ?? null,
    user_agent: args.context?.userAgent ?? null,
  });

  if (error) {
    console.error(
      `[lib/bridge/client-portal] client_access_log insert failed for operation=${args.operation}: ${error.message}`
    );
  }
}

type ResolvedToken = {
  tokenId: string;
  applicationId: string;
  orgId: string;
  recipientName: string | null;
  // Added sub-phase 2.5, for uploadDocument's audit-log external-actor
  // label only -- no 2.4 operation reads this field. `recipient_email_display`
  // is `not null` on client_access_tokens (20260814000001), unlike
  // `recipient_name`, so this is always a real value to fall back on.
  recipientEmailDisplay: string;
};

// Hash-lookup + status/expiry check, shared by every operation. Returns the
// token's two bare, unenforced cross-project pointers (`applicationId`,
// `orgId`) as a local authorization HINT only -- never the authoritative
// check (§0's design-constraint note). Every caller below still re-verifies
// against a live project-1 read before returning any project-1-sourced
// data.
async function resolveValidToken(
  portal: ClientPortalClient,
  rawToken: string,
  operation: string,
  context?: BridgeRequestContext
): Promise<{ ok: true; token: ResolvedToken } | { ok: false }> {
  const tokenHash = hashToken(rawToken);

  const { data: row, error } = await portal
    .from('client_access_tokens')
    .select('id, application_id, org_id, status, expires_at, recipient_name, recipient_email_display')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    console.error(`[lib/bridge/client-portal] client_access_tokens lookup failed: ${error.message}`);
    await logAttempt(portal, { tokenId: null, operation, outcome: 'denied', detail: 'token_not_found', context });
    return { ok: false };
  }

  if (!row) {
    await logAttempt(portal, { tokenId: null, operation, outcome: 'denied', detail: 'token_not_found', context });
    return { ok: false };
  }

  if (row.status !== 'active') {
    const detail: DenialDetail =
      row.status === 'revoked' ? 'token_revoked' : row.status === 'superseded' ? 'token_superseded' : 'token_expired';
    await logAttempt(portal, { tokenId: row.id, operation, outcome: 'denied', detail, context });
    return { ok: false };
  }

  // The lazy check (§3's failure-mode section's own term): `status` can
  // still read 'active' when `expires_at` has already passed, since nothing
  // in this schema proactively flips a row to 'expired' on a timer -- that
  // transition only ever happens lazily, the next time something looks.
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await logAttempt(portal, { tokenId: row.id, operation, outcome: 'denied', detail: 'token_expired', context });
    return { ok: false };
  }

  return {
    ok: true,
    token: {
      tokenId: row.id,
      applicationId: row.application_id,
      orgId: row.org_id,
      recipientName: row.recipient_name,
      recipientEmailDisplay: row.recipient_email_display,
    },
  };
}

// Sub-phase 2.5: the "display snapshot" GATE_2_0_FINDINGS.md's step 3
// describes for `audit_logs.external_actor_label` -- denormalized at write
// time, matching 20260806000030's own header comment ("recipient_email_display/
// recipient_name, not the normalized recipient_email"). Uses both fields
// together when a name is on file, matching the exact fixture shape
// lib/bridge/client-portal.live.test.ts's insertTokenFixture already builds
// ("Jane Test Recipient <email>") -- falls back to the email alone since
// `recipient_name` is nullable and `recipient_email_display` is not.
function buildExternalActorLabel(token: ResolvedToken): string {
  return token.recipientName ? `${token.recipientName} <${token.recipientEmailDisplay}>` : token.recipientEmailDisplay;
}

type ScopedApplication = {
  orgId: string;
  projectTitle: string;
  projectAddress: string;
  permitStatus: string;
};

// The live re-check §0's design-constraint note requires on every
// invocation, not just at token-issue time: takes the token's bare
// `applicationId`/`orgId` pointers and does a fresh existence + membership
// read against project 1, as service-role (bypasses RLS, so this check is
// this function's own explicit equality check, not RLS doing the work).
// Returns null for anything that isn't a clean, matching, live row --
// deleted application, application that moved orgs, or simply never
// existed -- so every caller collapses all three into the same
// `application_not_found` denial, never distinguishing them further.
async function loadScopedApplication(
  main: MainProjectClient,
  applicationId: string,
  orgId: string
): Promise<ScopedApplication | null> {
  const { data, error } = await main
    .from('permit_applications')
    .select('org_id, project_title, project_address, permit_status')
    .eq('id', applicationId)
    .maybeSingle();

  if (error) {
    console.error(`[lib/bridge/client-portal] permit_applications live re-check failed: ${error.message}`);
    return null;
  }
  if (!data || data.org_id !== orgId) {
    return null;
  }

  return {
    orgId: data.org_id,
    projectTitle: data.project_title,
    projectAddress: data.project_address,
    permitStatus: data.permit_status,
  };
}

// K.4 resolution (GATE_2_0_SPEC.md §3, "K.4 resolution" note): a
// bridge-computed prefix of `project_address` -- the text up to and
// including the first comma, or the whole string if it contains none.
// Never a `properties.city`/`province_code` join, since `project_id` is
// permanently nullable and a live, currently-open code path
// (createApplicationAction) never sets it.
function summarizeAddress(projectAddress: string): string {
  const commaIndex = projectAddress.indexOf(',');
  return commaIndex === -1 ? projectAddress : projectAddress.slice(0, commaIndex);
}

export type ResolveTokenResult =
  | {
      applicationId: string;
      orgName: string;
      propertyAddressSummary: string;
      recipientName: string | null;
    }
  | BridgeErrorResponse;

// §3's `resolveToken`: raw token string in, enough to render "Welcome,
// Jane -- viewing your application for 123 Main St." No internal ids beyond
// `applicationId` (needed by the client app for subsequent calls).
export async function resolveToken(
  rawToken: string,
  context?: BridgeRequestContext
): Promise<ResolveTokenResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'resolveToken', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'resolveToken',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  const { data: org, error: orgError } = await main
    .from('organizations')
    .select('name')
    .eq('id', token.orgId)
    .maybeSingle();

  if (orgError) {
    console.error(`[lib/bridge/client-portal] organizations live re-check failed: ${orgError.message}`);
  }
  if (!org) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'resolveToken',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  await logAttempt(portal, { tokenId: token.tokenId, operation: 'resolveToken', outcome: 'success', context });

  return {
    applicationId: token.applicationId,
    orgName: org.name,
    propertyAddressSummary: summarizeAddress(application.projectAddress),
    recipientName: token.recipientName,
  };
}

export type ApplicationStatusHistoryEntry = {
  toStatus: string;
  createdAt: string;
};

export type GetApplicationSummaryResult =
  | {
      permitStatus: string;
      projectTitle: string;
      propertyAddress: string;
      statusHistory: ApplicationStatusHistoryEntry[];
    }
  | BridgeErrorResponse;

// §3's `getApplicationSummary`: same authorization as `resolveToken`, plus
// the live re-check against the main project that `application_id` still
// exists.
export async function getApplicationSummary(
  rawToken: string,
  context?: BridgeRequestContext
): Promise<GetApplicationSummaryResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'getApplicationSummary', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getApplicationSummary',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  // `to_status`, `created_at` only -- not `changed_by`, an internal actor id
  // with no meaning to a client (§3's own table cell). Ascending by
  // `created_at`: oldest transition first, the same chronological-timeline
  // reading `bridge_read_grants.test.sql` already relies on for this table
  // (its `order by created_at asc limit 1` to reach the seeded 'intake' row).
  const { data: history, error: historyError } = await main
    .from('application_status_history')
    .select('to_status, created_at')
    .eq('application_id', token.applicationId)
    .order('created_at', { ascending: true });

  if (historyError) {
    console.error(`[lib/bridge/client-portal] application_status_history read failed: ${historyError.message}`);
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getApplicationSummary',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  await logAttempt(portal, {
    tokenId: token.tokenId,
    operation: 'getApplicationSummary',
    outcome: 'success',
    context,
  });

  return {
    permitStatus: application.permitStatus,
    projectTitle: application.projectTitle,
    propertyAddress: application.projectAddress,
    statusHistory: (history ?? []).map((row) => ({ toStatus: row.to_status, createdAt: row.created_at })),
  };
}

export type ReadinessChecklistItem = {
  title: string;
  isRequired: boolean;
  status: string;
};

export type GetReadinessChecklistResult = ReadinessChecklistItem[] | BridgeErrorResponse;

// §3's `getReadinessChecklist`: same authorization as `getApplicationSummary`.
export async function getReadinessChecklist(
  rawToken: string,
  context?: BridgeRequestContext
): Promise<GetReadinessChecklistResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'getReadinessChecklist', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getReadinessChecklist',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  const { data: items, error: itemsError } = await main
    .from('readiness_checklist_items')
    .select('title, is_required, status')
    .eq('application_id', token.applicationId)
    .order('created_at', { ascending: true });

  if (itemsError) {
    console.error(`[lib/bridge/client-portal] readiness_checklist_items read failed: ${itemsError.message}`);
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getReadinessChecklist',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  await logAttempt(portal, {
    tokenId: token.tokenId,
    operation: 'getReadinessChecklist',
    outcome: 'success',
    context,
  });

  return (items ?? []).map((row) => ({
    title: row.title,
    isRequired: row.is_required,
    status: row.status,
  }));
}

export type DocumentListEntry = {
  id: string;
  originalFilename: string;
  docKind: string;
  status: string;
  uploadedAt: string;
};

export type ListDocumentsResult = DocumentListEntry[] | BridgeErrorResponse;

// §3's `listDocuments`: same authorization as `getApplicationSummary`.
// Deliberately excludes `storage_path` (never handed to client-tier code --
// see `getDocumentDownloadUrl` below) and `sha256`/`byte_size` (internal
// integrity metadata, no client-facing purpose). Returns every document row
// for this application regardless of `archived_at` -- §3's own table cell
// does not scope this operation to non-archived documents the way
// `getDocumentDownloadUrl`'s is explicitly scoped; only the download
// operation itself enforces "must not be archived."
export async function listDocuments(
  rawToken: string,
  context?: BridgeRequestContext
): Promise<ListDocumentsResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'listDocuments', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'listDocuments',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  const { data: documents, error: documentsError } = await main
    .from('application_documents')
    .select('id, original_filename, doc_kind, status, uploaded_at')
    .eq('application_id', token.applicationId)
    .order('uploaded_at', { ascending: true });

  if (documentsError) {
    console.error(`[lib/bridge/client-portal] application_documents read failed: ${documentsError.message}`);
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'listDocuments',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  await logAttempt(portal, { tokenId: token.tokenId, operation: 'listDocuments', outcome: 'success', context });

  return (documents ?? []).map((row) => ({
    id: row.id,
    originalFilename: row.original_filename,
    docKind: row.doc_kind,
    status: row.status,
    uploadedAt: row.uploaded_at,
  }));
}

export type GetDocumentDownloadUrlResult = { url: string } | BridgeErrorResponse;

// §3's `getDocumentDownloadUrl`: same authorization as `getApplicationSummary`,
// plus `documentId` must belong to this token's `application_id` and the
// document must not be archived. A single short-TTL signed URL, nothing
// else.
export async function getDocumentDownloadUrl(
  rawToken: string,
  documentId: string,
  context?: BridgeRequestContext
): Promise<GetDocumentDownloadUrlResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'getDocumentDownloadUrl', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getDocumentDownloadUrl',
      resourceType: 'application_documents',
      resourceId: documentId,
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  const { data: document, error: documentError } = await main
    .from('application_documents')
    .select('id, application_id, storage_path, archived_at')
    .eq('id', documentId)
    .maybeSingle();

  if (documentError) {
    console.error(`[lib/bridge/client-portal] application_documents lookup failed: ${documentError.message}`);
  }

  if (!document || document.application_id !== token.applicationId) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getDocumentDownloadUrl',
      resourceType: 'application_documents',
      resourceId: documentId,
      outcome: 'denied',
      detail: 'document_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  if (document.archived_at !== null) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getDocumentDownloadUrl',
      resourceType: 'application_documents',
      resourceId: documentId,
      outcome: 'denied',
      detail: 'document_archived',
      context,
    });
    return { error: 'link_unavailable' };
  }

  // Same call shape as the existing convention (app/(app)/applications/[id]/page.tsx's
  // `supabase.storage.from(UPLOADS_BUCKET).createSignedUrl(...)`), not a new
  // pattern invented for the bridge layer (GATE_2_0_FINDINGS.md §L.2).
  const { data: signed, error: signError } = await main.storage
    .from(UPLOADS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error(
      `[lib/bridge/client-portal] createSignedUrl failed for document ${documentId}: ${signError?.message ?? 'no signed URL returned'}`
    );
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'getDocumentDownloadUrl',
      resourceType: 'application_documents',
      resourceId: documentId,
      outcome: 'denied',
      detail: 'document_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  await logAttempt(portal, {
    tokenId: token.tokenId,
    operation: 'getDocumentDownloadUrl',
    resourceType: 'application_documents',
    resourceId: documentId,
    outcome: 'success',
    context,
  });

  return { url: signed.signedUrl };
}

export type UploadDocumentResult = { documentId: string; status: string } | BridgeErrorResponse;

// §3's `uploadDocument`: same authorization/scope check as `listDocuments`
// (token resolves, application live-re-checks against this token's
// `applicationId`/`orgId`), plus MIME/size validation reused directly from
// `lib/storage/documents.ts` (`isAllowedMimeType`, `MAX_FILE_SIZE_BYTES`) --
// M.3 confirmed both helpers, `computeSha256`, and `buildStoragePath` are
// unchanged since 2.4's own live test already imports them directly. No
// `MAX_APPLICATION_TOTAL_BYTES` running-total check here -- §3's table cell
// names only the allowlist and the per-file cap as this operation's
// validation surface; the per-application total is app/api/documents/route.ts's
// own additional policy for internal uploads, not something §3 asked this
// operation to replicate.
//
// Returns only `{ documentId, status }` (§3's own cell: "No data returned
// beyond `{ documentId, status: 'pending' }` -- a bare acknowledgment, not
// the full row"). `status` is read back from the actual inserted/existing
// row rather than hardcoded, so this return value can never silently drift
// from `application_documents.status`'s real default
// (`document_review_status not null default 'pending'`, 20260806000024) if
// that default is ever changed.
//
// Storage-write authorization: `service_role`'s Storage API key bypasses
// `storage.objects` RLS entirely (M.3, confirmed against 20260806000013's
// own header comment) -- no new bucket policy needed for this write, same
// as `getDocumentDownloadUrl`'s existing signed-URL read above.
// `docKind` is passed through as a plain string rather than re-declared
// against a locally duplicated allowlist (app/api/documents/route.ts's own
// DOC_KINDS/isDocKind, defined inline there since lib/storage/documents.ts
// exports no shared doc_kind type) -- an invalid value is rejected by
// Postgres's own `doc_kind` enum type at the insert below, surfacing as the
// same generic `upload_failed` denial as any other insert failure. This is
// the same "GRANT/CHECK is the enforcement surface, not app code"
// discipline the rest of this bridge and lib/audit/log.ts's widened
// interface both already lean on, applied to a plain type constraint
// instead of a security-relevant CHECK.
export async function uploadDocument(
  rawToken: string,
  fileBytes: Buffer,
  originalFilename: string,
  mimeType: string,
  docKind: string,
  context?: BridgeRequestContext
): Promise<UploadDocumentResult> {
  if (!isClientPortalEnabled()) {
    return { error: 'link_unavailable' };
  }

  const portal = createClientPortalServiceClient();
  const resolved = await resolveValidToken(portal, rawToken, 'uploadDocument', context);
  if (!resolved.ok) {
    return { error: 'link_unavailable' };
  }
  const { token } = resolved;

  const main = createServiceClient();
  const application = await loadScopedApplication(main, token.applicationId, token.orgId);
  if (!application) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'uploadDocument',
      resourceType: 'application_documents',
      outcome: 'denied',
      detail: 'application_not_found',
      context,
    });
    return { error: 'link_unavailable' };
  }

  // MIME/size validation BEFORE any write (§6 2.5(a)) -- same ordering as
  // app/api/documents/route.ts's own per-file checks, reusing the identical
  // helpers rather than re-deriving the allowlist or the byte cap here.
  if (!isAllowedMimeType(mimeType)) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'uploadDocument',
      resourceType: 'application_documents',
      outcome: 'denied',
      detail: 'invalid_mime_type',
      context,
    });
    return { error: 'link_unavailable' };
  }

  if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) {
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'uploadDocument',
      resourceType: 'application_documents',
      outcome: 'denied',
      detail: 'file_too_large',
      context,
    });
    return { error: 'link_unavailable' };
  }

  // orgId here is `application.orgId` (the live re-checked value from
  // project 1), never `token.orgId` (the token's own bare, unenforced
  // pointer) -- same "the live re-check is authoritative, the token's
  // pointer is only a hint" discipline `loadScopedApplication`'s own header
  // comment describes. This is also what makes the storage path
  // impossible to steer at another application: it is built entirely from
  // server-verified `application.orgId`/`token.applicationId`, never from
  // anything the caller supplies.
  const sha256 = computeSha256(fileBytes);
  const storagePath = buildStoragePath(application.orgId, token.applicationId, sha256, originalFilename);

  // Same "duplicate/already exists is a legitimate no-op re-submission, not
  // a failure" tolerance as app/api/documents/route.ts's own upload step --
  // the sha256-in-path convention means a re-upload of identical bytes
  // lands on the same object path.
  const { error: uploadError } = await main.storage
    .from(UPLOADS_BUCKET)
    .upload(storagePath, fileBytes, { contentType: mimeType, upsert: false });

  if (uploadError && !/duplicate|already exists/i.test(uploadError.message)) {
    console.error(`[lib/bridge/client-portal] Storage upload failed for ${storagePath}: ${uploadError.message}`);
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'uploadDocument',
      resourceType: 'application_documents',
      outcome: 'denied',
      detail: 'upload_failed',
      context,
    });
    return { error: 'link_unavailable' };
  }

  const { data: inserted, error: insertError } = await main
    .from('application_documents')
    .insert({
      application_id: token.applicationId,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: mimeType,
      byte_size: fileBytes.byteLength,
      sha256,
      doc_kind: docKind,
    })
    .select('id, status')
    .maybeSingle();

  let documentId: string;
  let status: string;

  if (insertError) {
    // Duplicate (application_id, sha256): the file was already recorded by
    // an earlier call (or a genuinely concurrent one) -- not a failure, same
    // "already recorded, not an error" tolerance as the internal route.
    // Falls through to look up the existing row so this call still returns
    // a real `{ documentId, status }`, not a synthetic one.
    if (!/duplicate key value/i.test(insertError.message)) {
      console.error(`[lib/bridge/client-portal] application_documents insert failed: ${insertError.message}`);
      await logAttempt(portal, {
        tokenId: token.tokenId,
        operation: 'uploadDocument',
        resourceType: 'application_documents',
        outcome: 'denied',
        detail: 'upload_failed',
        context,
      });
      return { error: 'link_unavailable' };
    }

    const { data: existing, error: existingError } = await main
      .from('application_documents')
      .select('id, status')
      .eq('application_id', token.applicationId)
      .eq('sha256', sha256)
      .maybeSingle();

    if (existingError || !existing) {
      console.error(
        `[lib/bridge/client-portal] application_documents duplicate-row lookup failed: ${existingError?.message ?? 'no row found'}`
      );
      await logAttempt(portal, {
        tokenId: token.tokenId,
        operation: 'uploadDocument',
        resourceType: 'application_documents',
        outcome: 'denied',
        detail: 'upload_failed',
        context,
      });
      return { error: 'link_unavailable' };
    }

    documentId = existing.id;
    status = existing.status;
  } else if (inserted) {
    documentId = inserted.id;
    status = inserted.status;
  } else {
    console.error('[lib/bridge/client-portal] application_documents insert returned no row and no error.');
    await logAttempt(portal, {
      tokenId: token.tokenId,
      operation: 'uploadDocument',
      resourceType: 'application_documents',
      outcome: 'denied',
      detail: 'upload_failed',
      context,
    });
    return { error: 'link_unavailable' };
  }

  // The audit row (GATE_2_0_SPEC.md §4's "Does this gate wire up
  // writeAuditLog()?" section; user step 3). This is writeAuditLog()'s
  // first EXTERNAL-actor call site -- app/(app)/projects/new/actions.ts
  // (Phase 1.1) already calls it for the internal-actor shape, so this is
  // not the function's first call site overall, only the first to exercise
  // the branch 2.2/2.5 exist for. `main` (project 1's own service_role
  // client) is the caller -- the only way to write an external-actor row at
  // all, since no `authenticated` session exists for a client-portal
  // recipient in project 1 (see lib/audit/log.ts's own updated header
  // comment). A failed audit write does not fail the upload itself --
  // writeAuditLog()'s own contract -- but is logged loudly, since silently
  // losing the audit trail for a real mutation is worse than silently
  // losing it for a read.
  const { error: auditError } = await writeAuditLog(main, {
    orgId: application.orgId,
    externalActorId: token.tokenId,
    externalActorLabel: buildExternalActorLabel(token),
    action: 'client_document_upload',
    entityType: 'application_documents',
    entityId: documentId,
    afterSummary: { originalFilename, docKind, byteSize: fileBytes.byteLength },
    ip: context?.ip ?? null,
    userAgent: context?.userAgent ?? null,
  });
  if (auditError) {
    console.error(`[lib/bridge/client-portal] writeAuditLog failed for client_document_upload (document ${documentId}): ${auditError}`);
  }

  await logAttempt(portal, {
    tokenId: token.tokenId,
    operation: 'uploadDocument',
    resourceType: 'application_documents',
    resourceId: documentId,
    outcome: 'success',
    context,
  });

  return { documentId, status };
}
