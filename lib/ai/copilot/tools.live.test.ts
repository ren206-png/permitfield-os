// Gate 6.4 exit evidence: tool authorization against a real local Supabase
// with real user sessions (master prompt §17 N.4, §19 "model-trusted scope").
//
// Two staff users, one in each seed org, sign in with passwords this file
// sets. For each tool: a CONTROL run as org A's user inside org A's
// application returns A's data, then the same tool is run with org B's
// session but a FORGED scope pointing at org A's application -- as if a
// model or a bug passed A's ids -- and must return nothing of A's. RLS on
// the session is what stops it; the tools take no ids from the model.
//
// Run via `npm run test:live` (vitest.live.config.mts), after
// `supabase db reset`. Needs NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (the CLI's
// local demo keys; see .github/workflows/ci.yml).
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { createServiceClient } from '@/lib/supabase/service-client';
import { resolveCopilotScope, type CopilotScope } from './scope';
import {
  assessPackageReadiness,
  EvidenceRegistry,
  evaluatePermitApplicability,
  explainRequirement,
  getPermitStatus,
  resolveProjectAuthorities,
  type ToolContext,
} from './tools';

const ORG_A = '20000000-0000-0000-0000-00000000000a';
const ORG_B = '20000000-0000-0000-0000-00000000000b';
const APP_A = '40000000-0000-0000-0000-00000000000a';

const service = createServiceClient();

// The two seed owners (supabase/seed.sql PART 2, local/CI only) get a fresh
// random password for this run; service_role has no INSERT on org_members,
// so new staff users can't be added here.
const SEED_USERS: Record<string, string> = {
  [ORG_A]: '10000000-0000-0000-0000-00000000000a',
  [ORG_B]: '10000000-0000-0000-0000-00000000000b',
};

async function staffSession(orgId: string): Promise<{ client: SupabaseClient; userId: string }> {
  const userId = SEED_USERS[orgId];
  const password = randomUUID();
  const { data: updated, error } = await service.auth.admin.updateUserById(userId, { password });
  if (error || !updated.user?.email) throw new Error(`updateUserById failed: ${error?.message}`);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email: updated.user.email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { client, userId };
}

const ctx = (supabase: SupabaseClient, scope: CopilotScope): ToolContext => ({
  supabase,
  scope,
  evidence: new EvidenceRegistry(),
  now: new Date(),
});

let a: { client: SupabaseClient; userId: string };
let b: { client: SupabaseClient; userId: string };
let scopeA: CopilotScope;
let scopeFixture: CopilotScope;
let foreignRequirementId: string;

beforeAll(async () => {
  process.env.PERMITFIELD_FF_COPILOT_RULES = 'true';
  [a, b] = await Promise.all([staffSession(ORG_A), staffSession(ORG_B)]);
  const resolved = await resolveCopilotScope(a.client, a.userId, APP_A);
  if (!resolved) throw new Error('control: org A user should resolve org A application');
  scopeA = resolved;

  // A dedicated org A application with one checklist item, so the
  // readiness control has something to see. Created by org A's own user
  // (RLS) -- never on the shared seed application, whose empty checklist
  // lib/bridge/client-portal.live.test.ts relies on.
  const { data: fixtureApp, error: appError } = await a.client
    .from('permit_applications')
    .insert({
      org_id: ORG_A,
      contractor_id: '30000000-0000-0000-0000-00000000000a',
      permit_type_id: scopeA.permitTypeId,
      project_title: `Copilot live fixture ${randomUUID()}`,
      project_address: '1 Test Street',
    })
    .select('id')
    .single();
  if (appError || !fixtureApp) throw new Error(`fixture application failed: ${appError?.message}`);
  const { error } = await service
    .from('readiness_checklist_items')
    .insert({ org_id: ORG_A, application_id: fixtureApp.id, title: 'Copilot live fixture item', is_required: true });
  if (error) throw new Error(`readiness fixture failed: ${error.message}`);
  const resolvedFixture = await resolveCopilotScope(a.client, a.userId, fixtureApp.id);
  if (!resolvedFixture) throw new Error('control: org A user should resolve its fixture application');
  scopeFixture = resolvedFixture;

  // A requirement belonging to a DIFFERENT permit type than application A's.
  const { data: other } = await service.from('permit_requirements').select('id').neq('permit_type_id', scopeA.permitTypeId).limit(1).single();
  if (!other) throw new Error('fixture: need a requirement of another permit type');
  foreignRequirementId = other.id;
});

describe('copilot scope resolution', () => {
  test("another org's user cannot resolve the application (control: its own org can)", async () => {
    expect(scopeA.orgId).toBe(ORG_A);
    expect(await resolveCopilotScope(b.client, b.userId, APP_A)).toBeNull();
  });
});

describe('every tool, with a forged scope, returns nothing of the other org', () => {
  const forged = () => ({ ...scopeA, userId: b.userId });

  test('get_permit_status', async () => {
    const control = await getPermitStatus.run(ctx(a.client, scopeA), {});
    expect(control.ok).toBe(true);
    const attack = await getPermitStatus.run(ctx(b.client, forged()), {});
    expect(attack).toEqual({ ok: false, error: 'Application not found.' });
  });

  test('assess_package_readiness', async () => {
    const control = await assessPackageReadiness.run(ctx(a.client, scopeFixture), {});
    expect(control.ok && (control.data as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const attack = await assessPackageReadiness.run(ctx(b.client, { ...scopeFixture, userId: b.userId }), {});
    expect(attack.ok && (attack.data as { items: unknown[]; documents: unknown[] })).toMatchObject({ items: [], documents: [] });
  });

  test('evaluate_permit_applicability', async () => {
    const control = await evaluatePermitApplicability.run(ctx(a.client, scopeA), {});
    expect(control.ok).toBe(true);
    const attack = await evaluatePermitApplicability.run(ctx(b.client, forged()), {});
    expect(attack).toEqual({ ok: false, error: 'Application not found.' });
  });

  test('explain_requirement refuses a requirement outside the permit type (control: one inside works)', async () => {
    const { data: own } = await service.from('permit_requirements').select('id').eq('permit_type_id', scopeA.permitTypeId).limit(1).maybeSingle();
    if (own) expect((await explainRequirement.run(ctx(a.client, scopeA), { requirement_id: own.id })).ok).toBe(true);
    const attack = await explainRequirement.run(ctx(a.client, scopeA), { requirement_id: foreignRequirementId });
    expect(attack).toEqual({ ok: false, error: 'No such requirement for this permit type.' });
  });

  test('resolve_project_authorities returns only the scope municipality', async () => {
    const result = await resolveProjectAuthorities.run(ctx(a.client, scopeA), {});
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: { municipality: string } }).data.municipality).toContain(scopeA.jurisdictionName.split(',')[0]);
  });
});

describe('the evaluate tool writes its snapshot to the scope org, never another', () => {
  const count = async (orgId: string) =>
    (await service.from('project_requirement_snapshots').select('id', { count: 'exact', head: true }).eq('org_id', orgId)).count ?? 0;

  test('control: org A evaluating its own application writes snapshots to org A', async () => {
    const before = await count(ORG_A);
    await evaluatePermitApplicability.run(ctx(a.client, scopeA), {});
    expect(await count(ORG_A)).toBeGreaterThan(before);
  });

  test('org B with a forged scope writes nothing to either org', async () => {
    const [beforeA, beforeB] = await Promise.all([count(ORG_A), count(ORG_B)]);
    await evaluatePermitApplicability.run(ctx(b.client, { ...scopeA, userId: b.userId }), {});
    expect([await count(ORG_A), await count(ORG_B)]).toEqual([beforeA, beforeB]);
  });
});
