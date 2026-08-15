import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/authz';

// Lifecycle & Compliance Expansion, Phase 1.0: infrastructure for writing to
// the audit_logs ledger (20260806000018_lifecycle_rbac_roles_and_audit_log.sql).
//
// Gate 2.0 sub-phase 2.5 (GATE_2_0_FINDINGS.md §M.2) is this function's first
// real call site: lib/bridge/client-portal.ts's uploadDocument writes the
// `client_document_upload` row described below. Until 2.5, this file shipped
// as infrastructure only -- see git history for that prior state -- so this
// comment now describes both legal callers rather than a single deliberate
// one, matching what M.2 flagged: "session-scoped client only" stopped being
// true the moment a second, structurally different caller became real.
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
export async function writeAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  entry: AuditLogEntry
): Promise<{ data: WriteAuditLogResult | null; error: string | null }> {
  const { data, error } = await supabase
    .from('audit_logs')
    .insert({
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
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  if (!data) {
    return { data: null, error: 'Audit log insert returned no row.' };
  }
  return { data: { id: data.id }, error: null };
}
