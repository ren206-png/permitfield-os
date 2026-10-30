// Live: recordEnteredFact (enter-fact.ts) against the local stack, on the
// caller's own session, as the requirements check panel and the copilot
// call it. Proves an answer is stored confirmed and user-entered, a second
// answer supersedes the first (resolveFacts picks the new one), a value the
// key can't take is refused before any write, and RLS stops another org's
// owner from writing facts into this project even with its ids in hand.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { createServiceClient } from '@/lib/supabase/service-client';
import { SEED_OWNERS, signInSeedOwner } from '@/lib/test-support/seed-session';
import { recordEnteredFact } from './enter-fact';
import { resolveFacts, type ProjectFactRow } from './facts';

const PROJECT_A = '50000000-0000-0000-0000-00000000000a';
const KEY = 'building.year_built';
const service = createServiceClient();
let ownerA: SupabaseClient;
let ownerB: SupabaseClient;

async function factsFor(key: string) {
  const { data } = await service
    .from('project_facts')
    .select('id, fact_key, value, unit, state, provenance, supersedes_fact_id, created_at, created_by')
    .eq('project_id', PROJECT_A)
    .eq('fact_key', key);
  return (data ?? []) as (ProjectFactRow & { provenance: string; created_by: string })[];
}

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([signInSeedOwner(SEED_OWNERS.orgA.userId), signInSeedOwner(SEED_OWNERS.orgB.userId)]);
});

describe('recordEnteredFact', () => {
  const scopeA = { orgId: SEED_OWNERS.orgA.orgId, projectId: PROJECT_A, userId: SEED_OWNERS.orgA.userId };

  test('an answer is confirmed and user-entered; a later answer supersedes it', async () => {
    const before = (await factsFor(KEY)).length;
    expect(await recordEnteredFact(ownerA, scopeA, KEY, '1975')).toEqual({ ok: true });
    expect(await recordEnteredFact(ownerA, scopeA, KEY, '1995')).toEqual({ ok: true });

    const rows = await factsFor(KEY);
    expect(rows.length).toBe(before + 2);
    const newest = rows.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    expect(newest).toMatchObject({ value: 1995, unit: 'year', state: 'confirmed', provenance: 'user_entered', created_by: scopeA.userId });
    expect(newest.supersedes_fact_id).not.toBeNull();
    expect(resolveFacts(rows).facts.get(KEY)).toMatchObject({ status: 'confirmed', value: 1995 });
  });

  test('a value the key cannot take is refused before anything is written', async () => {
    const before = (await factsFor(KEY)).length;
    expect(await recordEnteredFact(ownerA, scopeA, KEY, '85')).toEqual({ ok: false, error: expect.stringContaining('four-digit year') });
    expect(await recordEnteredFact(ownerA, scopeA, 'project.not_a_key', 'yes')).toEqual({ ok: false, error: 'Choose a fact.' });
    expect((await factsFor(KEY)).length).toBe(before);
  });

  test("another org's owner cannot write into this project, even with its ids", async () => {
    const strata = 'building.strata_titled';
    const before = (await factsFor(strata)).length;
    // Control: org A's own owner can.
    expect(await recordEnteredFact(ownerA, scopeA, strata, 'no')).toEqual({ ok: true });
    const result = await recordEnteredFact(ownerB, { ...scopeA, userId: SEED_OWNERS.orgB.userId }, strata, 'yes');
    expect(result.ok).toBe(false);
    const rows = await factsFor(strata);
    expect(rows.length).toBe(before + 1);
    expect(rows.every((r) => r.created_by !== SEED_OWNERS.orgB.userId)).toBe(true);
  });
});
