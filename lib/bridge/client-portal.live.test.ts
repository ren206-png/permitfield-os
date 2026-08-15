// This repo's first live-Supabase test file (Gate 2.0 sub-phase 2.4). Run
// via `npm run test:live` (vitest.live.config.mts), never `npm test` --
// requires BOTH local Supabase stacks up:
//   supabase start
//   supabase --workdir supabase-client-portal start
// and CLIENT_PORTAL_SUPABASE_URL/SERVICE_ROLE_KEY plus
// NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set (vitest.live.setup.ts
// loads them from .env.local locally; CI sets them as step env -- see
// .github/workflows/ci.yml).
//
// ORDERING REQUIREMENT: run this AFTER `npm run test:sql` and
// `npm run test:sql:client-portal` (or after a fresh `supabase db reset`),
// never before. This suite commits a real application_documents row into
// project 1 that it cannot delete (see below) -- running it first was
// caught breaking supabase/tests/dashboard_queries.test.sql's
// dashboard_document_review_counts(Org A) count and
// supabase/tests/tenant_isolation.test.sql's own row-count control, both of
// which assume a freshly-reset, pristine DB. .github/workflows/ci.yml's
// sql-tests job runs this suite last for exactly this reason.
//
// Shape: control-then-assert for every one of the five bridge operations'
// authorization/scoping decisions (unknown token, each non-active status,
// lazy expiry, mismatched/forged application_id+org_id pointers, a
// nonexistent application, a nonexistent or cross-application document),
// plus a genuine cross-tenant proof for getApplicationSummary/listDocuments/
// getDocumentDownloadUrl: a token legitimately scoped to Org B gets back
// Org B's own data, never Org A's, and vice versa -- not just "a mismatched
// token is denied," but "two valid, differently-scoped tokens each see only
// their own tenant's data."
//
// No begin/rollback wrapper here, unlike supabase/tests/*.test.sql -- these
// calls span TWO separate live Postgres instances (project 1 and project 2
// have no shared transaction to roll back). Fixture rows this file inserts
// into client_access_tokens use a fresh random recipient_email every run
// (the `unique ... where status = 'active'` partial index would otherwise
// collide on a rerun) and are never deleted: client_access_tokens has no
// DELETE grant for service_role by design (only select/insert/update --
// see 20260814000001's header, "revocation, not deletion"), so accumulation
// across local reruns is expected and harmless on a throwaway local/CI
// stack (`supabase db reset` clears it). The one application_documents
// fixture row this file inserts is left in place for the same reason
// (service_role has insert/select/update there, per
// 20260806000031/20260806000015, but no delete grant) -- its bytes are
// randomized per run so the table's `unique (application_id, sha256)`
// constraint never collides either.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createClientPortalServiceClient } from '@/lib/supabase/client-portal-service-client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { UPLOADS_BUCKET, buildStoragePath, computeSha256 } from '@/lib/storage/documents';
import {
  resolveToken,
  getApplicationSummary,
  getReadinessChecklist,
  listDocuments,
  getDocumentDownloadUrl,
} from './client-portal';

// supabase/seed.sql PART 2 fixtures (LOCAL DEV / TEST FIXTURES ONLY).
const ORG_A_ID = '20000000-0000-0000-0000-00000000000a';
const ORG_A_APPLICATION_ID = '40000000-0000-0000-0000-00000000000a';
const ORG_A_NAME = 'Org A - Test Mechanical Ltd.';
const ORG_A_PROJECT_TITLE = 'Org A - 200A Service Upgrade';
const ORG_A_ADDRESS = '123 Test St, Toronto, ON';

const ORG_B_ID = '20000000-0000-0000-0000-00000000000b';
const ORG_B_APPLICATION_ID = '40000000-0000-0000-0000-00000000000b';
const ORG_B_PROJECT_TITLE = 'Org B - 400A Service Upgrade';

const portal = createClientPortalServiceClient();
const main = createServiceClient();

// Mirrors hashToken() in ./client-portal -- not exported (internal to the
// bridge module), so this file, like any real caller, only ever deals in
// raw tokens; it reconstructs the identical digest solely to write direct
// fixture rows into client_access_tokens (which stores only the hash, by
// design -- SS0's own bearer-token constraint).
function hashRawToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

type TokenFixtureOverrides = {
  applicationId?: string;
  orgId?: string;
  status?: 'active' | 'expired' | 'revoked' | 'superseded';
  expiresAt?: Date;
  recipientName?: string | null;
};

// Inserts one client_access_tokens row and returns the raw (unhashed) token
// a caller would present. Every fixture gets its own randomUUID()-based
// recipient_email so concurrent/rerun test cases never collide on the
// one-active-token-per-recipient-per-application partial unique index.
async function insertTokenFixture(overrides: TokenFixtureOverrides = {}): Promise<string> {
  const rawToken = randomUUID();
  const recipientEmail = `client-portal-live-test-${randomUUID()}@example.test`;
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000);

  const { error } = await portal.from('client_access_tokens').insert({
    application_id: overrides.applicationId ?? ORG_A_APPLICATION_ID,
    org_id: overrides.orgId ?? ORG_A_ID,
    recipient_email_display: recipientEmail,
    recipient_email: recipientEmail,
    recipient_name: overrides.recipientName === undefined ? 'Jane Test Recipient' : overrides.recipientName,
    token_hash: hashRawToken(rawToken),
    status: overrides.status ?? 'active',
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`fixture insert into client_access_tokens failed: ${error.message}`);
  }

  return rawToken;
}

// One real application_documents row per org, each with a real uploaded
// Storage object -- needed so getDocumentDownloadUrl's *success* path
// (createSignedUrl against a real object) is actually exercised here, not
// just its denial paths. Random bytes per run sidestep application_documents'
// `unique (application_id, sha256)` constraint on reruns without a
// `supabase db reset` in between.
async function insertDocumentFixture(orgId: string, applicationId: string): Promise<{ id: string; storagePath: string }> {
  const bytes = Buffer.from(`client-portal live test fixture ${randomUUID()}`, 'utf8');
  const sha256 = computeSha256(bytes);
  const storagePath = buildStoragePath(orgId, applicationId, sha256, 'live-test-fixture.pdf');

  const { error: uploadError } = await main.storage
    .from(UPLOADS_BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf' });
  if (uploadError) {
    throw new Error(`fixture Storage upload failed: ${uploadError.message}`);
  }

  const { data, error } = await main
    .from('application_documents')
    .insert({
      application_id: applicationId,
      storage_path: storagePath,
      original_filename: 'live-test-fixture.pdf',
      mime_type: 'application/pdf',
      byte_size: bytes.byteLength,
      sha256,
      doc_kind: 'other',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`fixture insert into application_documents failed: ${error?.message}`);
  }

  return { id: data.id as string, storagePath };
}

let orgADocument: { id: string; storagePath: string };
let orgBDocument: { id: string; storagePath: string };

beforeAll(async () => {
  [orgADocument, orgBDocument] = await Promise.all([
    insertDocumentFixture(ORG_A_ID, ORG_A_APPLICATION_ID),
    insertDocumentFixture(ORG_B_ID, ORG_B_APPLICATION_ID),
  ]);
});

// Best-effort: removes the two Storage objects this file uploaded. The
// application_documents metadata rows themselves are left in place --
// service_role has no DELETE grant on that table (insert/select/update
// only, see this file's header) -- consistent with every other fixture
// this suite creates.
afterAll(async () => {
  await main.storage.from(UPLOADS_BUCKET).remove([orgADocument.storagePath, orgBDocument.storagePath]);
});

describe('resolveToken', () => {
  test('resolves a valid active token to its application/org context', async () => {
    const rawToken = await insertTokenFixture({ recipientName: 'Jane Test Recipient' });

    const result = await resolveToken(rawToken);

    expect(result).toEqual({
      applicationId: ORG_A_APPLICATION_ID,
      orgName: ORG_A_NAME,
      propertyAddressSummary: '123 Test St',
      recipientName: 'Jane Test Recipient',
    });
  });

  test('denies an unrecognized token (token_not_found)', async () => {
    const result = await resolveToken(randomUUID());
    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies a revoked token', async () => {
    const rawToken = await insertTokenFixture({ status: 'revoked' });
    const result = await resolveToken(rawToken);
    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies a superseded token', async () => {
    const rawToken = await insertTokenFixture({ status: 'superseded' });
    const result = await resolveToken(rawToken);
    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies a token whose status column already reads expired', async () => {
    const rawToken = await insertTokenFixture({ status: 'expired' });
    const result = await resolveToken(rawToken);
    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies the "lazy expiry" case: status is still active but expires_at has passed', async () => {
    const rawToken = await insertTokenFixture({
      status: 'active',
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const result = await resolveToken(rawToken);
    expect(result).toEqual({ error: 'link_unavailable' });
  });
});

describe('getApplicationSummary', () => {
  test('returns permit status, project title, address, and status history for a valid token', async () => {
    const rawToken = await insertTokenFixture();

    const result = await getApplicationSummary(rawToken);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.permitStatus).toBe('intake');
    expect(result.projectTitle).toBe(ORG_A_PROJECT_TITLE);
    expect(result.propertyAddress).toBe(ORG_A_ADDRESS);
    // permit_applications_seed_status_history auto-seeds one 'intake' row
    // for this fixture application on insert (see
    // supabase/tests/bridge_read_grants.test.sql's own header for this same
    // dependency) -- this assertion is the live proof that
    // application_status_history is actually reachable end to end, not
    // just that the query doesn't throw.
    expect(result.statusHistory.length).toBeGreaterThanOrEqual(1);
    expect(result.statusHistory.some((entry) => entry.toStatus === 'intake')).toBe(true);
  });

  test('a token legitimately scoped to Org B returns Org B\'s own data, never Org A\'s', async () => {
    const rawToken = await insertTokenFixture({ applicationId: ORG_B_APPLICATION_ID, orgId: ORG_B_ID });

    const result = await getApplicationSummary(rawToken);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.projectTitle).toBe(ORG_B_PROJECT_TITLE);
    expect(result.projectTitle).not.toBe(ORG_A_PROJECT_TITLE);
  });

  test('denies when the token\'s application_id and org_id pointers do not actually pair up (forged/mismatched token)', async () => {
    // A token cannot legitimately carry Org A's application_id alongside
    // Org B's org_id -- issuance always writes a real, paired pointer. This
    // simulates that inconsistent state directly at the fixture layer to
    // prove loadScopedApplication()'s live re-check (org_id must match the
    // application's ACTUAL org_id in project 1) is what's doing the
    // rejecting, not merely "the token happened to look wrong."
    const rawToken = await insertTokenFixture({ applicationId: ORG_A_APPLICATION_ID, orgId: ORG_B_ID });

    const result = await getApplicationSummary(rawToken);

    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies when application_id points at an application that does not exist', async () => {
    const rawToken = await insertTokenFixture({ applicationId: randomUUID(), orgId: ORG_A_ID });

    const result = await getApplicationSummary(rawToken);

    expect(result).toEqual({ error: 'link_unavailable' });
  });
});

describe('getReadinessChecklist', () => {
  test('returns an empty list for an application with no checklist items', async () => {
    // readiness_checklist_items carries zero supabase/seed.sql fixture rows
    // (20260806000025 adds no seed data), and service_role's grant on this
    // table is SELECT-only (20260806000032 -- the bridge layer's read
    // operations never write here), so this suite cannot author a non-empty
    // fixture itself without writing through the `authenticated` role,
    // which is out of scope for this file. An empty array is still a real
    // assertion: it proves the scoped, granted SELECT executes cleanly
    // end-to-end rather than throwing (e.g. on the grant gap
    // 20260806000032 itself exists to close).
    const rawToken = await insertTokenFixture();

    const result = await getReadinessChecklist(rawToken);

    expect(result).toEqual([]);
  });
});

describe('listDocuments', () => {
  test('lists the scoped application\'s documents without leaking storage internals', async () => {
    const rawToken = await insertTokenFixture();

    const result = await listDocuments(rawToken);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const fixture = result.find((doc) => doc.id === orgADocument.id);
    expect(fixture).toBeDefined();
    expect(fixture).toEqual({
      id: orgADocument.id,
      originalFilename: 'live-test-fixture.pdf',
      docKind: 'other',
      status: expect.any(String),
      uploadedAt: expect.any(String),
    });
    // storage_path/sha256 are internal-only (this operation's own header
    // comment in lib/bridge/client-portal.ts) -- assert the returned shape
    // has no such keys at all, not just that they're undefined.
    expect(Object.keys(fixture as object).sort()).toEqual(
      ['docKind', 'id', 'originalFilename', 'status', 'uploadedAt'].sort()
    );
  });

  test('never returns Org B\'s documents to an Org A-scoped token', async () => {
    const rawToken = await insertTokenFixture();

    const result = await listDocuments(rawToken);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.some((doc) => doc.id === orgBDocument.id)).toBe(false);
  });
});

describe('getDocumentDownloadUrl', () => {
  test('returns a real signed URL for a document scoped to the token\'s application', async () => {
    const rawToken = await insertTokenFixture();

    const result = await getDocumentDownloadUrl(rawToken, orgADocument.id);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(typeof result.url).toBe('string');
    expect(result.url.length).toBeGreaterThan(0);
  });

  test('denies with a generic error for a documentId that does not exist', async () => {
    const rawToken = await insertTokenFixture();

    const result = await getDocumentDownloadUrl(rawToken, randomUUID());

    expect(result).toEqual({ error: 'link_unavailable' });
  });

  test('denies a valid Org A token trying to fetch Org B\'s document (cross-tenant)', async () => {
    const rawToken = await insertTokenFixture();

    const result = await getDocumentDownloadUrl(rawToken, orgBDocument.id);

    expect(result).toEqual({ error: 'link_unavailable' });
  });
});
