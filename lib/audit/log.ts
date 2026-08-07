import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/authz';

// Lifecycle & Compliance Expansion, Phase 1.0: infrastructure for writing to
// the audit_logs ledger (20260806000018_lifecycle_rbac_roles_and_audit_log.sql).
//
// *** NOT CALLED FROM ANY ROUTE YET. *** This phase ships the table, the RLS
// policies, and this helper -- wiring it into app/api/**/route.ts handlers
// (e.g. logging every findings/review confirm-or-dismiss, every submit) is
// explicitly out of scope for "foundation" and left to a later phase. Its
// existence with zero call sites does not change any current behavior; see
// the Phase 1.0 report's "What's NOT done" section.
//
// Takes the caller's own session-scoped Supabase client (the same
// `createClient()` from lib/supabase/server.ts every Route Handler in this
// repo already uses) rather than instantiating one itself or accepting a
// service-role client. This is deliberate, matching the discipline documented
// in app/api/documents/route.ts and re-affirmed in this phase's own re-read
// of app/api/applications/[id]/findings/[findingId]/review/route.ts: writing
// as the caller means audit_logs_insert's RLS check
// (`is_org_member(org_id) and actor_user_id = auth.uid()`) is enforced by
// Postgres itself, not merely trusted at the application layer. A future
// background-job writer (Inngest, via service-client.ts) would need its own
// explicit path -- 20260806000018 already grants service_role select/insert
// proactively for that day, but no such caller exists yet.
export interface AuditLogEntry {
  orgId: string;
  actorUserId: string;
  actorRole: Role;
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
      actor_user_id: entry.actorUserId,
      actor_role: entry.actorRole,
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
