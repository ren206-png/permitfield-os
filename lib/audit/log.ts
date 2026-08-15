import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/authz';

// Lifecycle & Compliance Expansion, Phase 1.0: infrastructure for writing to
// the audit_logs ledger (20260806000018_lifecycle_rbac_roles_and_audit_log.sql).
//
// Call-site history, corrected here (GATE_2_0_FINDINGS.md §O.6 found this
// same "first call site" drift in GATE_2_0_SPEC.md §6, and, on a closer
// re-read while fixing that one, in this file's own header too -- both
// said "first," neither was, since app/(app)/projects/new/actions.ts's
// `project.created` write (Phase 1.1) predates both): the actual first
// call site is Phase 1.1's `project.created` write (internal-actor shape).
// Gate 2.0 sub-phase 2.5 (GATE_2_0_FINDINGS.md §M.2) is the first call site
// for the EXTERNAL-actor shape specifically: lib/bridge/client-portal.ts's
// uploadDocument writes the `client_document_upload` row described below.
// Until 2.5, this file's external-actor branch shipped unexercised -- see
// git history for that prior state -- so this comment now describes both
// legal callers rather than a single deliberate one, matching what M.2
// flagged: "session-scoped client only" stopped being true the moment a
// second, structurally different caller became real. Sub-phase 2.6 adds a
// third call site (lib/bridge/client-portal-admin.ts's issueToken/
// revokeToken, internal-actor shape) -- see docs/PERMISSIONS.md's "Current
// status" section for the up-to-date count; this header does not attempt
// to enumerate every call site going forward, only to stop repeating the
// specific "first" claim that had already gone stale twice.
//
// There are exactly two legal shapes for `entry`, mirroring
// audit_logs_actor_exactly_one_populated (20260806000030) branch for branch
// so the TypeScript shape and the SQL CHECK can't silently diverge:
//   - Internal staff actor: `actorUserId`/`actorRole` populated,
//     `externalActorId`/`externalActorLabel` omitted. The caller passes its
//     own session-scoped Supabase client (the same `createClient()` from
//     lib/supabase/server.ts every Route Handler in this repo already uses),
//     never a service-role client, for this shape -- writing as the caller
//     means audit_logs_insert's RLS check
//     (`is_org_member(org_id) and actor_user_id = auth.uid()`) is enforced
//     by Postgres itself, not merely trusted at the application layer.
//   - External (client-portal) actor: `externalActorId`/`externalActorLabel`
//     populated, `actorUserId`/`actorRole` omitted. No `authenticated`
//     session exists for a client-portal recipient in this project at all,
//     so this shape is only ever written by a service_role client
//     (lib/supabase/service-client.ts) -- 20260806000018 already granted
//     service_role select/insert on audit_logs proactively for this day;
//     lib/bridge/client-portal.ts's uploadDocument is the first caller to
//     actually use it.
//
// This function does not itself throw if a caller passes neither shape or
// both -- audit_logs_actor_exactly_one_populated is the sole enforcement
// surface (this codebase's established "GRANT/CHECK is the enforcement
// surface, not app code" discipline, e.g. GATE_2_0_SPEC.md §5's "the GRANT
// is the entire enforcement surface"): a malformed call surfaces as a
// Postgres CHECK-violation error from the insert below, not a client-side
// assertion duplicating what the DB already guarantees.
export interface AuditLogEntry {
  orgId: string;
  // Internal-actor shape. Both populated together, or both omitted --
  // never one without the other; see audit_logs_actor_exactly_one_populated.
  actorUserId?: string;
  actorRole?: Role;
  // External-actor shape (Gate 2.0 sub-phase 2.2/2.5). externalActorId is
  // the client_access_tokens row id (project 2, non-FK by necessity -- see
  // 20260806000030's header); externalActorLabel is a denormalized
  // recipient-identity snapshot, never re-derived from a live join back to
  // project 2.
  externalActorId?: string;
  externalActorLabel?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeSummary?: unknown;
  afterSummary?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface WriteAuditLogResult {
  id: string;
}

// Returns the error rather than throwing: a failed audit-log write should
// not be allowed to take down the primary action it was describing (e.g. a
// finding confirm/dismiss should still succeed even if, hypothetically, the
// ledger insert failed) -- callers decide whether that tradeoff is
// acceptable for their own call site, this helper does not decide it for
// them by throwing.
//
// Gate 2.0 sub-phase 2.6 bug fix: this used to end the insert with
// `.select('id').maybeSingle()` to hand callers back the new row's id (see
// WriteAuditLogResult below -- kept for now since it's still the documented
// public return shape, even though `data` is always null; see next
// paragraph). That `.select()` turns the write into an INSERT ... RETURNING
// under the hood, and Postgres RLS applies the table's SELECT-policy USING
// clause to RETURNING output even though the row already satisfied the
// INSERT policy's WITH CHECK -- see
// https://www.postgresql.org/docs/current/ddl-rowsecurity.html ("RETURNING
// clause ... additionally checked against SELECT policies"). audit_logs_insert
// (20260806000018) is deliberately broader than audit_logs_select ("Any org
// member may write a log entry describing their OWN action -- this is
// intentionally broader than audit_logs_select": select is owner/org_owner/
// platform_admin/auditor_readonly only), so any internal-actor write by a
// role admitted for insert but not select -- e.g. permit_manager, which
// sub-phase 2.6 is the first caller to actually use as an internal actor --
// failed outright with a misleading "new row violates row-level security
// policy for table \"audit_logs\"" (misleading because it names the INSERT
// policy's error text but is actually the RETURNING/SELECT check), and the
// whole INSERT rolled back -- not just the read-back. Caught by
// lib/bridge/client-portal-admin.live.test.ts's revokeTokenById-by-permit_manager
// test. No caller anywhere in this repo actually reads the returned id
// (grep confirms), so the fix is to drop the `.select()` entirely rather
// than widen audit_logs_select (which would blur the read/write distinction
// 20260806000018 deliberately drew). `data` is therefore always null on
// success now -- callers should only branch on `error`.
export async function writeAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  entry: AuditLogEntry
): Promise<{ data: WriteAuditLogResult | null; error: string | null }> {
  const { error } = await supabase.from('audit_logs').insert({
    org_id: entry.orgId,
    actor_user_id: entry.actorUserId ?? null,
    actor_role: entry.actorRole ?? null,
    external_actor_id: entry.externalActorId ?? null,
    external_actor_label: entry.externalActorLabel ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    before_summary: entry.beforeSummary ?? null,
    after_summary: entry.afterSummary ?? null,
    ip: entry.ip ?? null,
    user_agent: entry.userAgent ?? null,
  });

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: null, error: null };
}
