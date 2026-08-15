// Gate 2.0 sub-phase 2.6 (GATE_2_0_SPEC.md §7 item 2; scoped/approved in
// GATE_2_0_FINDINGS.md §O as "APPROVED: PHASE 2.6"). Live-Supabase tests for
// lib/bridge/client-portal-admin.ts, the staff-facing sibling of
// lib/bridge/client-portal.ts and its own live test file
// (client-portal.live.test.ts, whose header comment explains this repo's
// live-test infrastructure in full -- same two-stack requirement, same
// `npm run test:live` entry point, same ordering requirement relative to
// `npm run test:sql`/`npm run test:sql:client-portal`, not repeated here).
//
// Division of labor with supabase/tests/client_access_token_staff_functions.test.sql:
// that file is the exhaustive, single-transaction proof that
// can_issue_client_access_token()/can_revoke_client_access_token() (project
// 1 SQL functions) admit and refuse every role tier, including the
// asymmetric permit_manager case -- the actual enforcement boundary. This
// file does NOT re-run that full matrix; duplicating five role/function
// combinations across two live Postgres instances per test would be slow
// and would not prove anything the SQL file doesn't already prove more
// directly. What this file proves instead is everything that SQL file
// structurally cannot:
//   1. That issueToken()/revokeTokenById()/revokeTokenForRecipient() (the
//      TypeScript layer) actually WIRE UP those RPC checks correctly end to
//      end -- one authorized-success and one unauthorized-refusal case per
//      operation, exercised through the real module, not called directly.
//   2. The §1 first-issuance 23505 race, which by construction requires two
//      genuinely concurrent Postgres transactions each seeing zero existing
//      rows before either commits -- impossible to reproduce inside a
//      single begin/rollback SQL test file (a fixture row inserted directly
//      would just be visible to the SELECT ... FOR UPDATE and take the
//      normal re-issuance branch, never reaching the exception handler).
//      Promise.all here fires two real, concurrent HTTP/PostgREST requests
//      against the local project-2 stack instead.
//   3. Both revocation paths actually flip a real row's status and write a
//      real token_lifecycle_events row, and that a revoked token then fails
//      resolveToken() (lib/bridge/client-portal.ts) on its very next call --
//      closing the loop between this sub-phase's write path and 2.4's read
//      path, which spans both this file's own RPCs and the sibling module's
//      resolveToken(), so only a live test can prove it end to end.
//   4. The p_org_id scoping fix on both revocation SQL functions (added
//      after an authorization-scoping gap was caught while writing this
//      module -- see that migration's own header): an org-B-authorized
//      caller cannot revoke an org-A token by supplying org B's org_id.
//
// SESSION-SCOPED TEST CLIENTS: production code gets a session-scoped
// project-1 client from lib/supabase/server.ts's createClient(), which
// binds to Next.js's cookie jar -- meaningless outside a request. This file
// instead creates real auth.users rows via the service-role client's
// `auth.admin.createUser()` (the same admin API a real invite/signup flow
// uses), then signs in with `@supabase/supabase-js`'s plain createClient()+
// signInWithPassword() using the SAME literal password
// supabase/tests/*.test.sql fixtures use ('test-password-not-real', via
// crypt()/gen_salt('bf') there and GoTrue's own bcrypt hashing here).
// Functionally this is identical to what lib/supabase/server.ts resolves to
// for RLS/RPC purposes -- both are just a Supabase client carrying a real
// user's JWT on every request, which is all `auth.uid()` and PostgREST's
// role-switching care about; only the cookie-transport mechanism differs,
// and that mechanism has no bearing on anything this module's authorization
// checks read.
//
// Adding the new fixture users' org_members rows is NOT done with the
// service-role client (`main`): org_members has no service_role GRANT at
// all (20260806000011_grants.sql grants insert/update/delete only to
// `authenticated`) -- BYPASSRLS only skips row-level security policies, not
// the table-level privilege grant Postgres still requires underneath it,
// the same "GRANT is the enforcement surface" discipline this codebase's
// own migrations document repeatedly (e.g. audit_logs' own explicit
// service_role grant). This file is not the place to widen that grant just
// to make a test's fixture setup convenient -- doing so would be a real,
// undocumented security-surface change smuggled in as test plumbing. So
// instead it does the same thing a real invite flow would: resets
// seed.sql's Org A/Org B seeded owners' passwords via
// `auth.admin.updateUserById()` (their shipped `encrypted_password` is a
// placeholder, non-bcrypt string that cannot sign in at all --
// 'not-a-real-hash-local-dev-only', see supabase/seed.sql) so this file can
// sign in as them, then uses THEIR session-scoped client -- a real
// `is_org_owner()`-satisfying actor -- to insert every other fixture user's
// org_members row, exactly the way org_members_insert's own policy expects
// membership to be granted. Mutating the seeded owners' passwords has no
// lasting effect: this is a throwaway local/CI stack `supabase db reset`
// clears on the next run, same as every other fixture this suite and its
// sibling live test file leave behind.
//
// This is this repo's first live test to sign in as a real user rather than
// only using service-role clients (client-portal.live.test.ts never
// authenticates as anyone -- project 2 has no `authenticated` role at all,
// and project 1 access there is entirely token-mediated, not session-
// mediated) -- see the CI workflow change accompanying this file for the
// one new env var (NEXT_PUBLIC_SUPABASE_ANON_KEY) that requires.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Client as PgClient } from 'pg';
import { createClientPortalServiceClient } from '@/lib/supabase/client-portal-service-client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { resolveToken } from './client-portal';
import { issueToken, revokeTokenById, revokeTokenForRecipient } from './client-portal-admin';

// supabase/seed.sql PART 2 fixtures.
const ORG_A_ID = '20000000-0000-0000-0000-00000000000a';
const ORG_A_APPLICATION_ID = '40000000-0000-0000-0000-00000000000a';
const ORG_A_SEEDED_OWNER_ID = '10000000-0000-0000-0000-00000000000a';
const ORG_A_SEEDED_OWNER_EMAIL = 'org-a-owner@example.test';
const ORG_B_ID = '20000000-0000-0000-0000-00000000000b';
const ORG_B_SEEDED_OWNER_ID = '10000000-0000-0000-0000-00000000000b';
const ORG_B_SEEDED_OWNER_EMAIL = 'org-b-owner@example.test';

// Same literal password every supabase/tests/*.test.sql fixture user is
// seeded with (see e.g. permit_requirements_engine.test.sql's 060/061) --
// reused here, not because it needs to match anything, but so a reader who
// has already seen that convention recognizes this isn't a "real" secret.
const TEST_PASSWORD = 'test-password-not-real';

const portal = createClientPortalServiceClient();
const main = createServiceClient();

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured -- required for this file\'s session-scoped test clients (see this file\'s own header).'
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Fixture = { userId: string; email: string; client: SupabaseClient };

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return client;
}

// Resets a seed.sql-seeded owner's password (their shipped
// encrypted_password cannot authenticate at all -- see this file's header)
// and returns their session-scoped client. Used only to obtain an
// is_org_owner()-satisfying actor for inserting this file's own org_members
// fixture rows below, and, for Org B, directly as the cross-org test actor.
async function getSeededOwnerClient(userId: string, email: string): Promise<SupabaseClient> {
  const { error } = await main.auth.admin.updateUserById(userId, { password: TEST_PASSWORD });
  if (error) {
    throw new Error(`resetting seeded owner password failed for ${email}: ${error.message}`);
  }
  return signInAs(email, TEST_PASSWORD);
}

// Creates one real auth.users row (via the admin API, the same mechanism a
// real invite flow uses) and one org_members row for it -- inserted through
// `addedByClient` (a real is_org_owner()-satisfying session, per this file's
// header on why `main`, the service-role client, cannot do this insert
// itself) -- then returns a signed-in session-scoped client for the new
// user. See this file's header for why a plain signInWithPassword() client
// is equivalent to lib/supabase/server.ts's createClient() for every
// purpose this file needs.
async function createOrgMemberFixture(orgId: string, role: string, addedByClient: SupabaseClient): Promise<Fixture> {
  const email = `client-portal-admin-live-test-${randomUUID()}@example.test`;
  const { data, error } = await main.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`fixture auth.users creation failed: ${error?.message}`);
  }
  const userId = data.user.id;

  const { error: memberError } = await addedByClient.from('org_members').insert({ org_id: orgId, user_id: userId, role });
  if (memberError) {
    throw new Error(`fixture org_members insert failed: ${memberError.message}`);
  }

  const client = await signInAs(email, TEST_PASSWORD);
  return { userId, email, client };
}

async function countActiveTokensForRecipient(applicationId: string, recipientEmail: string): Promise<number> {
  const { count, error } = await portal
    .from('client_access_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('application_id', applicationId)
    .eq('recipient_email', recipientEmail.toLowerCase())
    .eq('status', 'active');
  if (error) {
    throw new Error(`client_access_tokens count failed: ${error.message}`);
  }
  return count ?? 0;
}

async function getAuditRows(tokenId: string, action: string) {
  const { data, error } = await main
    .from('audit_logs')
    .select('actor_user_id, actor_role, action, entity_type, entity_id, after_summary')
    .eq('entity_id', tokenId)
    .eq('action', action);
  if (error) {
    throw new Error(`audit_logs select failed: ${error.message}`);
  }
  return data ?? [];
}

async function getTokenLifecycleEvents(tokenId: string) {
  const { data, error } = await portal
    .from('token_lifecycle_events')
    .select('token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system')
    .eq('token_id', tokenId);
  if (error) {
    throw new Error(`token_lifecycle_events select failed: ${error.message}`);
  }
  return data ?? [];
}

// Org A fixtures: an org_owner (authorized for both issue and revoke) and a
// plain member (authorized for neither) -- deliberately NOT reusing
// seed.sql's Org A 'owner' user, which has a placeholder, non-bcrypt
// encrypted_password ('not-a-real-hash-local-dev-only') and so cannot
// actually sign in via signInWithPassword().
let orgAIssuer: Fixture;
let orgARevoker: Fixture;
let orgAMember: Fixture;
// Org B fixture: an owner authorized in Org B only, used for the
// cross-org revocation-scoping proof (item 4 in this file's header).
let orgBOwner: Fixture;

beforeAll(async () => {
  const [orgAOwnerClient, orgBOwnerClient] = await Promise.all([
    getSeededOwnerClient(ORG_A_SEEDED_OWNER_ID, ORG_A_SEEDED_OWNER_EMAIL),
    getSeededOwnerClient(ORG_B_SEEDED_OWNER_ID, ORG_B_SEEDED_OWNER_EMAIL),
  ]);

  orgBOwner = { userId: ORG_B_SEEDED_OWNER_ID, email: ORG_B_SEEDED_OWNER_EMAIL, client: orgBOwnerClient };

  [orgAIssuer, orgARevoker, orgAMember] = await Promise.all([
    createOrgMemberFixture(ORG_A_ID, 'org_owner', orgAOwnerClient),
    createOrgMemberFixture(ORG_A_ID, 'permit_manager', orgAOwnerClient),
    createOrgMemberFixture(ORG_A_ID, 'member', orgAOwnerClient),
  ]);
}, 30000);

// Best-effort: this repo's fixture users accumulate across local reruns the
// same way client_access_tokens/token_lifecycle_events rows do in the
// sibling live test file (no DELETE grant path exercised here either) --
// `supabase db reset` clears everything on a throwaway local/CI stack. No
// afterAll cleanup call is made for the same reason that file gives for its
// own leftover fixtures: harmless accumulation on a stack nobody depends on
// staying pristine across runs.
afterAll(async () => {
  // Intentionally empty -- see comment above.
});

describe('issueToken', () => {
  test('an authorized org_owner issues a fresh token and writes exactly one audit_logs row', async () => {
    const recipientEmailDisplay = `issue-success-${randomUUID()}@example.test`;

    const result = await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      recipientName: 'Issue Success Recipient',
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    const data = result.data!;
    expect(data.wasCreated).toBe(true);
    expect(typeof data.rawToken).toBe('string');
    expect(data.rawToken).not.toBeNull();

    const auditRows = await getAuditRows(data.tokenId, 'client_access_token.issued');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_user_id).toBe(orgAIssuer.userId);
    expect(auditRows[0].actor_role).toBe('org_owner');

    const events = await getTokenLifecycleEvents(data.tokenId);
    expect(events).toHaveLength(1);
    expect(events[0].from_status).toBeNull();
    expect(events[0].to_status).toBe('active');
  });

  test('an unauthorized plain member is refused with not_authorized and creates no token or audit row', async () => {
    const recipientEmailDisplay = `issue-refused-${randomUUID()}@example.test`;

    const result = await issueToken(orgAMember.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAMember.userId,
      actorRole: 'member',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe('not_authorized');

    const activeCount = await countActiveTokensForRecipient(ORG_A_APPLICATION_ID, recipientEmailDisplay);
    expect(activeCount).toBe(0);
  });

  test('the first-issuance 23505 race: two genuinely concurrent transactions resolve to exactly one created token, never a raw constraint error', async () => {
    // This test used to fire two issueToken() calls via Promise.all and rely
    // on that to produce genuine Postgres-level concurrency. Empirically it
    // didn't: a direct run showed the two HTTP/PostgREST round trips landing
    // ~350 microseconds apart, which was still enough time for the first
    // call's entire transaction (SELECT ... FOR UPDATE, INSERT, COMMIT) to
    // finish before the second call's own SELECT ... FOR UPDATE ran -- so
    // the second call legitimately took the ordinary "if found" re-issuance
    // branch (superseding the first row and inserting a fresh active one),
    // never reaching issue_client_access_token()'s unique_violation exception
    // handler at all. Both calls reported wasCreated: true, which is a
    // correct outcome for THAT interleaving, but not the specific race §1
    // and this suite need to prove is handled -- Promise.all over two
    // independent HTTP requests cannot reliably guarantee the sub-millisecond
    // overlap a first-issuance collision needs, since neither request's
    // start time nor its transaction's duration is something this process
    // controls once it enters supabase-js/PostgREST.
    //
    // So this test drives two raw Postgres connections directly instead,
    // which lets it force the exact interleaving deterministically:
    //   1. Connection A opens a transaction and calls
    //      issue_client_access_token() -- the SAME production RPC
    //      issueToken() calls -- but does not commit yet. Its INSERT is now
    //      present in the unique index but invisible to other transactions
    //      (ordinary MVCC), so nothing has "happened" from B's point of view.
    //   2. Connection B opens its own transaction and calls the same
    //      function with the same recipient/application. Its own
    //      SELECT ... FOR UPDATE genuinely finds nothing (A's row isn't
    //      visible pre-commit), so B also proceeds to INSERT -- and blocks,
    //      because Postgres unique-index insertion waits on other
    //      transactions holding a conflicting not-yet-resolved entry,
    //      regardless of MVCC visibility.
    //   3. Committing A resolves that wait: B's blocked INSERT now sees a
    //      real conflict, raises unique_violation internally, and
    //      issue_client_access_token()'s own exception handler (not this
    //      test) catches it and returns wasCreated: false with A's row's
    //      identity -- exactly the behavior §1 specifies.
    // This proves the SQL function's own race handling with certainty
    // rather than probabilistically. The ordinary-path wiring (issueToken()
    // correctly calling this same RPC, writing audit_logs/lifecycle rows) is
    // already proven by the "authorized org_owner issues a fresh token" test
    // above, through the real TypeScript module -- this test's job is narrower
    // and complementary, same division-of-labor principle as this file's own
    // header describes for supabase/tests/client_access_token_staff_functions.test.sql.
    const dbUrl = process.env.CLIENT_PORTAL_DB_URL;
    if (!dbUrl) {
      throw new Error('CLIENT_PORTAL_DB_URL is not configured -- required for this test\'s raw-connection race proof.');
    }

    const recipientEmailDisplay = `issue-race-${randomUUID()}@example.test`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const hashOf = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
    const tokenHashA = hashOf(randomBytes(32).toString('base64url'));
    const tokenHashB = hashOf(randomBytes(32).toString('base64url'));

    const clientA = new PgClient({ connectionString: dbUrl });
    const clientB = new PgClient({ connectionString: dbUrl });
    await clientA.connect();
    await clientB.connect();

    const callIssueFn = (client: PgClient, tokenHash: string) =>
      client.query(
        `select token_id, expires_at, was_created
         from issue_client_access_token($1, $2, $3, $4, $5, $6, $7)`,
        [
          ORG_A_ID,
          ORG_A_APPLICATION_ID,
          recipientEmailDisplay,
          null,
          tokenHash,
          expiresAt,
          orgAIssuer.userId,
        ]
      );

    let resultA: { token_id: string; expires_at: string; was_created: boolean };
    let resultB: { token_id: string; expires_at: string; was_created: boolean };
    try {
      await clientA.query('begin');
      resultA = (await callIssueFn(clientA, tokenHashA)).rows[0];

      await clientB.query('begin');
      // Fired but not awaited yet -- B's INSERT blocks server-side waiting
      // on A's still-open, conflicting transaction. Awaiting it here would
      // deadlock this test against clientA.query('commit') below, since
      // nothing else would ever unblock it.
      const bPromise = callIssueFn(clientB, tokenHashB);

      // Give B's query a moment to actually reach Postgres and block on the
      // unique index before committing A -- a generous margin (not a tight
      // race) since the only failure mode of waiting too long here is a
      // slower test, not a flaky one; too short would risk committing A
      // before B's INSERT has even been dispatched, which would make B take
      // the ordinary re-issuance branch instead of the race path this test
      // exists to prove.
      await new Promise((resolve) => setTimeout(resolve, 200));

      await clientA.query('commit');
      resultB = (await bPromise).rows[0];
      await clientB.query('commit');
    } catch (err) {
      await clientA.query('rollback').catch(() => {});
      await clientB.query('rollback').catch(() => {});
      throw err;
    } finally {
      await clientA.end();
      await clientB.end();
    }

    // A, which committed first with nothing to collide against, is the
    // winner; B, which blocked on A's uncommitted insert and only saw the
    // conflict once A committed, is the loser -- deterministic given the
    // ordering this test itself controls above, not an assumption.
    expect(resultA.was_created).toBe(true);
    expect(resultB.was_created).toBe(false);

    // The loser's row is the winner's -- confirming the exception handler's
    // re-select found the real committed row, not a raw 23505 error leaking
    // out of the function (which would have thrown out of the `await
    // callIssueFn(...)` call above instead of resolving normally).
    expect(resultB.token_id).toBe(resultA.token_id);

    // Exactly one active row exists for this recipient+application -- the
    // partial unique index was raced against and correctly resolved, never
    // actually violated in the committed data.
    const activeCount = await countActiveTokensForRecipient(ORG_A_APPLICATION_ID, recipientEmailDisplay);
    expect(activeCount).toBe(1);

    // Exactly one token_lifecycle_events row was written (from_status: null
    // -> active) -- B's invocation, having lost the race, wrote no
    // lifecycle event of its own; it re-selected A's already-committed row
    // instead, matching issue_client_access_token()'s own documented
    // exception-handler behavior.
    const events = await getTokenLifecycleEvents(resultA.token_id);
    expect(events).toHaveLength(1);
  });
});

describe('revocation', () => {
  test('revokeTokenById: an authorized permit_manager revokes an active token, writes one audit_logs row, and the token then fails resolveToken', async () => {
    const recipientEmailDisplay = `revoke-by-id-${randomUUID()}@example.test`;
    const issued = await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });
    expect(issued.data).not.toBeNull();
    const { tokenId, rawToken } = issued.data!;
    expect(rawToken).not.toBeNull();

    // Control: the freshly issued token resolves successfully before
    // revocation -- proves the subsequent failure is caused BY the
    // revocation below, not some unrelated fixture problem.
    const beforeRevoke = await resolveToken(rawToken!);
    expect('error' in beforeRevoke).toBe(false);

    const revoked = await revokeTokenById(orgARevoker.client, {
      orgId: ORG_A_ID,
      tokenId,
      actorUserId: orgARevoker.userId,
      actorRole: 'permit_manager',
    });

    expect(revoked.error).toBeNull();
    expect(revoked.data).toEqual({ revoked: true, tokenId, applicationId: ORG_A_APPLICATION_ID });

    const auditRows = await getAuditRows(tokenId, 'client_access_token.revoked');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_user_id).toBe(orgARevoker.userId);
    expect(auditRows[0].actor_role).toBe('permit_manager');

    const events = await getTokenLifecycleEvents(tokenId);
    expect(events.some((e) => e.from_status === 'active' && e.to_status === 'revoked')).toBe(true);

    // Assert: the revoked token fails resolveToken() on its next call.
    const afterRevoke = await resolveToken(rawToken!);
    expect(afterRevoke).toEqual({ error: 'link_unavailable' });
  });

  test('revokeTokenById: an unauthorized plain member is refused with not_authorized and the token remains active', async () => {
    const recipientEmailDisplay = `revoke-by-id-refused-${randomUUID()}@example.test`;
    const issued = await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });
    const { tokenId, rawToken } = issued.data!;

    const revoked = await revokeTokenById(orgAMember.client, {
      orgId: ORG_A_ID,
      tokenId,
      actorUserId: orgAMember.userId,
      actorRole: 'member',
    });

    expect(revoked.data).toBeNull();
    expect(revoked.error).toBe('not_authorized');

    const stillActive = await resolveToken(rawToken!);
    expect('error' in stillActive).toBe(false);
  });

  test('revokeTokenById: an org-B-authorized caller cannot revoke an org-A token by supplying org B\'s org_id (p_org_id scoping)', async () => {
    const recipientEmailDisplay = `revoke-cross-org-${randomUUID()}@example.test`;
    const issued = await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });
    const { tokenId, rawToken } = issued.data!;

    // orgBOwner IS authorized to revoke -- but only within Org B. Passing
    // Org B's own org_id (the only org they're authorized against) against
    // an Org A token_id must find nothing, not leak across tenants.
    const revoked = await revokeTokenById(orgBOwner.client, {
      orgId: ORG_B_ID,
      tokenId,
      actorUserId: orgBOwner.userId,
      actorRole: 'owner',
    });

    expect(revoked.error).toBeNull();
    expect(revoked.data).toEqual({ revoked: false, tokenId: null, applicationId: null });

    const stillActive = await resolveToken(rawToken!);
    expect('error' in stillActive).toBe(false);
  });

  test('revokeTokenForRecipient: an authorized org_owner revokes by recipient, writes one audit_logs row, and the token then fails resolveToken', async () => {
    const recipientEmailDisplay = `revoke-by-recipient-${randomUUID()}@example.test`;
    const issued = await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });
    const { tokenId, rawToken } = issued.data!;

    const revoked = await revokeTokenForRecipient(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmail: recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });

    expect(revoked.error).toBeNull();
    expect(revoked.data).toEqual({ revoked: true, tokenId, applicationId: ORG_A_APPLICATION_ID });

    const auditRows = await getAuditRows(tokenId, 'client_access_token.revoked');
    expect(auditRows).toHaveLength(1);

    const afterRevoke = await resolveToken(rawToken!);
    expect(afterRevoke).toEqual({ error: 'link_unavailable' });

    // Revoking again for the same recipient (nothing left active) is a
    // clean no-op, not an error.
    const revokedAgain = await revokeTokenForRecipient(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmail: recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });
    expect(revokedAgain.error).toBeNull();
    expect(revokedAgain.data).toEqual({ revoked: false, tokenId: null, applicationId: null });
  });

  test('revokeTokenForRecipient: an unauthorized plain member is refused with not_authorized', async () => {
    const recipientEmailDisplay = `revoke-by-recipient-refused-${randomUUID()}@example.test`;
    await issueToken(orgAIssuer.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmailDisplay,
      actorUserId: orgAIssuer.userId,
      actorRole: 'org_owner',
    });

    const revoked = await revokeTokenForRecipient(orgAMember.client, {
      orgId: ORG_A_ID,
      applicationId: ORG_A_APPLICATION_ID,
      recipientEmail: recipientEmailDisplay,
      actorUserId: orgAMember.userId,
      actorRole: 'member',
    });

    expect(revoked.data).toBeNull();
    expect(revoked.error).toBe('not_authorized');

    const activeCount = await countActiveTokensForRecipient(ORG_A_APPLICATION_ID, recipientEmailDisplay);
    expect(activeCount).toBe(1);
  });
});
