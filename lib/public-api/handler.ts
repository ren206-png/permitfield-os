import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isPublicApiEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { hashApiKey, parseBearerToken } from './keys';

// The one entry point every app/api/v1/* route goes through. It runs on the
// service-role client (lib/supabase/service-client.ts, Exception 3): the
// caller is an API key, not a Supabase Auth session, so there is no RLS
// session to use. Tenant isolation therefore rests on `orgId` below, which
// only ever comes from the org_api_keys row the presented key hashed to --
// never from the request -- and every resources.ts query filters on it.

export const KEY_RATE_LIMIT_PER_MINUTE = 120;
export const DENIED_IP_LIMIT = 20;
export const DENIED_IP_WINDOW_MINUTES = 15;

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ApiContext {
  client: ServiceClient;
  orgId: string;
  searchParams: URLSearchParams;
}

type Outcome = 'ok' | 'denied' | 'forbidden' | 'error';

interface ResolvedKey {
  id: string;
  orgId: string;
}

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function apiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Pure, unit-tested: a count at or above the cap is over the limit.
export function isOverLimit(count: number, max: number): boolean {
  return count >= max;
}

function clientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const first = forwardedFor?.split(',')[0]?.trim();
  return first ? first : null;
}

async function logRequest(
  client: ServiceClient,
  request: NextRequest,
  ip: string | null,
  statusCode: number,
  outcome: Outcome,
  key: ResolvedKey | null
) {
  const { error } = await client.from('api_request_log').insert({
    org_id: key?.orgId ?? null,
    api_key_id: key?.id ?? null,
    ip,
    method: request.method,
    path: request.nextUrl.pathname,
    status_code: statusCode,
    outcome,
  });
  if (error) {
    console.error(`[lib/public-api] api_request_log insert failed: ${error.message}`);
  }
}

// Rate-limit reads fail OPEN (count 0) on a DB error: they are
// defense-in-depth in front of the hash lookup, and an outage in the log
// table must not become an outage of the whole API.
async function countSince(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    console.error(`[lib/public-api] ${label} rate-limit count failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

export async function handleApiRequest(
  request: NextRequest,
  run: (ctx: ApiContext) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!isPublicApiEnabled()) {
    return apiError(404, 'not_found', 'Not found.');
  }

  const client = createServiceClient();
  const ip = clientIp(request);

  if (ip) {
    const since = new Date(Date.now() - DENIED_IP_WINDOW_MINUTES * 60_000).toISOString();
    const denied = await countSince(
      client
        .from('api_request_log')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip)
        .eq('outcome', 'denied')
        .is('api_key_id', null)
        .gte('created_at', since),
      'ip'
    );
    if (isOverLimit(denied, DENIED_IP_LIMIT)) {
      return apiError(429, 'rate_limited', 'Too many failed authentication attempts. Try again later.', {
        'Retry-After': String(DENIED_IP_WINDOW_MINUTES * 60),
      });
    }
  }

  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) {
    await logRequest(client, request, ip, 401, 'denied', null);
    return apiError(401, 'unauthorized', 'Missing or invalid API key. Send "Authorization: Bearer <key>".');
  }

  const { data: keyRow, error: keyError } = await client
    .from('org_api_keys')
    .select('id, org_id, revoked_at')
    .eq('key_hash', hashApiKey(token))
    .maybeSingle();
  if (keyError) {
    console.error(`[lib/public-api] org_api_keys lookup failed: ${keyError.message}`);
    return apiError(500, 'internal_error', 'Internal error.');
  }
  if (!keyRow) {
    await logRequest(client, request, ip, 401, 'denied', null);
    return apiError(401, 'unauthorized', 'Missing or invalid API key. Send "Authorization: Bearer <key>".');
  }

  const key: ResolvedKey = { id: keyRow.id, orgId: keyRow.org_id };
  if (keyRow.revoked_at !== null) {
    await logRequest(client, request, ip, 401, 'denied', key);
    return apiError(401, 'unauthorized', 'This API key has been revoked.');
  }

  if (!(await can(key.orgId, 'api.access', client))) {
    await logRequest(client, request, ip, 403, 'forbidden', key);
    return apiError(403, 'forbidden', 'Your organization’s plan does not include API access.');
  }

  const recent = await countSince(
    client
      .from('api_request_log')
      .select('id', { count: 'exact', head: true })
      .eq('api_key_id', key.id)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString()),
    'key'
  );
  if (isOverLimit(recent, KEY_RATE_LIMIT_PER_MINUTE)) {
    return apiError(429, 'rate_limited', `Rate limit of ${KEY_RATE_LIMIT_PER_MINUTE} requests per minute exceeded.`, {
      'Retry-After': '60',
    });
  }

  const stampLastUsed = client
    .from('org_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(({ error }) => {
      if (error) {
        console.error(`[lib/public-api] last_used_at update failed: ${error.message}`);
      }
    });

  let response: NextResponse;
  try {
    response = await run({ client, orgId: key.orgId, searchParams: request.nextUrl.searchParams });
  } catch (err) {
    console.error('[lib/public-api] handler threw:', err);
    response = apiError(500, 'internal_error', 'Internal error.');
  }

  await Promise.all([
    stampLastUsed,
    logRequest(client, request, ip, response.status, response.status >= 500 ? 'error' : 'ok', key),
  ]);
  return response;
}
