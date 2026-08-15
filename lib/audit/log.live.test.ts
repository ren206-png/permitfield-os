// Gate 2.0 sub-phase 2.5 (GATE_2_0_FINDINGS.md §M.2). Proves writeAuditLog()'s
// widened AuditLogEntry interface actually round-trips both legal actor
// shapes through a real DB call, and that a malformed call (neither or both
// shapes populated) is rejected by audit_logs_actor_exactly_one_populated
// (20260806000030) when exercised through the TypeScript function itself --
// not a re-test of the SQL CHECK in isolation, which
// supabase/tests/audit_logs_external_actor.test.sql already covers
// end-to-end at the SQL layer (control-then-assert, dropping and restoring
// the constraint). This file's job is narrower and complementary: does
// writeAuditLog() actually construct an insert payload that lands on the
// right branch of that CHECK for each legal shape, and does it surface (not
// swallow) the CHECK violation for an illegal one.
//
// Run via `npm run test:live` (vitest.live.config.mts) -- see
// lib/bridge/client-portal.live.test.ts's header for the two-stack setup
// this repo's live tests share. This file only touches project 1 (the main
// app's Supabase project); it does not need the client-portal project at
// all, so it has no CLIENT_PORTAL_SUPABASE_* dependency.
//
// audit_logs has no DELETE grant for service_role (20260806000018 grants
// only select/insert) -- append-only by the same forbid_update_delete()
// trigger every other ledger table in this schema uses. Every row this file
// inserts is left in place, same "accumulation across reruns is expected
// and harmless on a throwaway local/CI stack" reasoning as
// client-portal.live.test.ts's own header -- `supabase db reset` clears it.
// Actions are namespaced under `test.audit_log_live.*` so they're never
// mistaken for a real product event by anything scanning the ledger.
import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service-client';
import { writeAuditLog } from './log';

// supabase/seed.sql PART 2 fixtures (LOCAL DEV / TEST FIXTURES ONLY) -- the
// same Org A identity client-portal.live.test.ts already relies on.
const ORG_A_ID = '20000000-0000-0000-0000-00000000000a';
const ORG_A_OWNER_USER_ID = '10000000-0000-0000-0000-00000000000a';

const main = createServiceClient();

async function fetchRow(id: string) {
  const { data, error } = await main.from('audit_logs').select('*').eq('id', id).single();
  if (error || !data) {
    throw new Error(`failed to read back audit_logs row ${id}: ${error?.message}`);
  }
  return data;
}

describe('writeAuditLog external-actor / internal-actor branches (live)', () => {
  test('internal-actor shape (actorUserId + actorRole) writes successfully', async () => {
    const { data, error } = await writeAuditLog(main, {
      orgId: ORG_A_ID,
      actorUserId: ORG_A_OWNER_USER_ID,
      actorRole: 'owner',
      action: 'test.audit_log_live.internal_actor',
      entityType: 'audit_log_live_test',
      entityId: randomUUID(),
    });

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();

    const row = await fetchRow(data!.id);
    expect(row.actor_user_id).toBe(ORG_A_OWNER_USER_ID);
    expect(row.actor_role).toBe('owner');
    expect(row.external_actor_id).toBeNull();
    expect(row.external_actor_label).toBeNull();
  });

  test('external-actor shape (externalActorId + externalActorLabel) writes successfully', async () => {
    const externalActorId = randomUUID();

    const { data, error } = await writeAuditLog(main, {
      orgId: ORG_A_ID,
      externalActorId,
      externalActorLabel: 'Jane Test Recipient <client-portal-live-test@example.test>',
      action: 'test.audit_log_live.external_actor',
      entityType: 'audit_log_live_test',
      entityId: randomUUID(),
    });

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();

    const row = await fetchRow(data!.id);
    expect(row.actor_user_id).toBeNull();
    expect(row.actor_role).toBeNull();
    expect(row.external_actor_id).toBe(externalActorId);
    expect(row.external_actor_label).toBe('Jane Test Recipient <client-portal-live-test@example.test>');
  });

  test('neither actor shape populated is rejected by audit_logs_actor_exactly_one_populated', async () => {
    const { data, error } = await writeAuditLog(main, {
      orgId: ORG_A_ID,
      action: 'test.audit_log_live.neither_actor',
      entityType: 'audit_log_live_test',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error).toContain('audit_logs_actor_exactly_one_populated');
  });

  test('both actor shapes populated together is rejected by audit_logs_actor_exactly_one_populated', async () => {
    const { data, error } = await writeAuditLog(main, {
      orgId: ORG_A_ID,
      actorUserId: ORG_A_OWNER_USER_ID,
      actorRole: 'owner',
      externalActorId: randomUUID(),
      externalActorLabel: 'Should never land',
      action: 'test.audit_log_live.both_actor_shapes',
      entityType: 'audit_log_live_test',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error).toContain('audit_logs_actor_exactly_one_populated');
  });

  test('an external-actor label without an external-actor id is rejected by audit_logs_external_actor_label_requires_id', async () => {
    // Deliberately paired with a VALID internal-actor shape
    // (actorUserId+actorRole) so audit_logs_actor_exactly_one_populated is
    // satisfied on its own terms (that constraint only looks at
    // actor_user_id/actor_role/external_actor_id, never the label column) --
    // isolating this case to the OTHER illegal shape
    // 20260806000030 added (audit_logs_external_actor_label_requires_id),
    // rather than re-proving the "neither populated" case above under a
    // different name. writeAuditLog()'s insert forwards externalActorLabel
    // independently of externalActorId (both `?? null`), so a caller bug
    // that supplies a label without an id is exactly as reachable through
    // this function as the two shapes above, and deserves its own live
    // proof distinct from the "neither"/"both" actor-shape cases.
    const { data, error } = await writeAuditLog(main, {
      orgId: ORG_A_ID,
      actorUserId: ORG_A_OWNER_USER_ID,
      actorRole: 'owner',
      externalActorLabel: 'Label with no id',
      action: 'test.audit_log_live.label_without_id',
      entityType: 'audit_log_live_test',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error).toContain('audit_logs_external_actor_label_requires_id');
  });
});
