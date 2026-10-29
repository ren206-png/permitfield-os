import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { robotsVerdict } from './robots';
import { isPublicIpAddress, validateSourceUrl } from './url-guard';

// Gate 6.3: fetches one registered source for a check (master prompt §7,
// §10). Bounded in every direction: https only, every DNS answer must be a
// public address (checked inside the socket's own lookup, so the address
// that is connected to is the one that was checked), at most
// MAX_REDIRECTS redirects each re-validated, a total timeout, and a byte
// cap enforced while streaming. Conditional request headers come from the
// last successful check, so an unchanged page can answer 304.
//
// Never throws for a network or policy problem: every outcome is a value,
// because a failed fetch is recorded as a failed check -- it never retires
// or alters the source (§7 "failed fetch ≠ repeal").

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const SOURCE_CHECK_USER_AGENT = 'PermitFieldOS-SourceCheck/1.0 (+https://www.permitfieldos.com)';
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const ROBOTS_TIMEOUT_MS = 5_000;

export type FetchSourceResult =
  | {
      kind: 'ok';
      status: number;
      finalUrl: string;
      contentType: string;
      bytes: Buffer;
      etag: string | null;
      lastModified: string | null;
    }
  | { kind: 'not_modified'; status: 304; finalUrl: string; etag: string | null; lastModified: string | null }
  | { kind: 'failed' | 'blocked'; code: string; message: string; status?: number; finalUrl?: string };

export interface FetchSourceOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  // Gate 6.7: consult robots.txt before fetching (default true).
  respectRobots?: boolean;
}

// Reads https://<host>/robots.txt with the same guard (public addresses
// only, https only, size and time caps). Redirects are not followed: a
// redirected robots.txt is treated as unavailable, i.e. not fetched now.
async function readRobots(origin: URL): Promise<{ status: number | null; body: string | null }> {
  const robotsUrl = new URL('/robots.txt', origin);
  const guard = validateSourceUrl(robotsUrl.toString());
  if (!guard.ok) return { status: null, body: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
  try {
    const { response } = await requestOnce(guard.url, { 'user-agent': SOURCE_CHECK_USER_AGENT, accept: 'text/plain', 'accept-encoding': 'identity' }, controller.signal);
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.resume();
      return { status, body: null };
    }
    return { status, body: (await readBody(response, ROBOTS_MAX_BYTES)).toString('utf8') };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

class BlockedAddressError extends Error {
  code = 'address_not_public';
}

// dns.lookup wrapper that refuses to hand back a non-public address. Used as
// the request's `lookup`, so it runs for the socket actually opened.
// Exported for tests.
export function guardedLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicIpAddress(a.address))) {
      return callback(new BlockedAddressError(`${hostname} resolves to a non-public address`), []);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<{ response: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers, lookup: guardedLookup, signal }, (response) => resolve({ response }));
    req.on('error', reject);
    req.end();
  });
}

function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy(new Error('too_large'));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
  });
}

export async function fetchSource(rawUrl: string, options: FetchSourceOptions = {}): Promise<FetchSourceResult> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let current = rawUrl;
  const robotsChecked = new Set<string>();
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = validateSourceUrl(current);
      if (!guard.ok) return { kind: 'blocked', code: guard.code, message: guard.message, finalUrl: current };

      if (options.respectRobots !== false && !robotsChecked.has(guard.url.origin)) {
        robotsChecked.add(guard.url.origin);
        const robots = await readRobots(guard.url);
        const verdict = robotsVerdict(robots.status, robots.body, `${guard.url.pathname}${guard.url.search}`);
        if (verdict === 'disallowed') {
          return { kind: 'blocked', code: 'robots_disallowed', message: "The site's robots.txt asks automated tools not to fetch this page.", finalUrl: current };
        }
        if (verdict === 'unavailable') {
          return { kind: 'failed', code: 'robots_unavailable', message: "The site's robots.txt could not be read; not fetched this time.", finalUrl: current };
        }
      }

      const headers: Record<string, string> = {
        'user-agent': SOURCE_CHECK_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9',
        'accept-encoding': 'identity',
      };
      // Conditional headers only for the registered URL itself.
      if (hop === 0 && options.etag) headers['if-none-match'] = options.etag;
      if (hop === 0 && options.lastModified) headers['if-modified-since'] = options.lastModified;

      const { response } = await requestOnce(guard.url, headers, controller.signal);
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && status !== 304) {
        response.resume();
        const location = response.headers.location;
        if (!location) return { kind: 'failed', code: 'redirect_without_location', message: `HTTP ${status} without a Location header.`, status, finalUrl: current };
        current = new URL(location, guard.url).toString();
        continue;
      }

      const etag = typeof response.headers.etag === 'string' ? response.headers.etag : null;
      const lastModified = typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'] : null;

      if (status === 304) {
        response.resume();
        return { kind: 'not_modified', status: 304, finalUrl: current, etag, lastModified };
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return { kind: 'failed', code: 'http_error', message: `HTTP ${status}.`, status, finalUrl: current };
      }

      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        return { kind: 'failed', code: 'too_large', message: `Larger than ${maxBytes} bytes.`, status, finalUrl: current };
      }
      const bytes = await readBody(response, maxBytes);
      return {
        kind: 'ok',
        status,
        finalUrl: current,
        contentType: String(response.headers['content-type'] ?? '').toLowerCase(),
        bytes,
        etag,
        lastModified,
      };
    }
    return { kind: 'failed', code: 'too_many_redirects', message: `More than ${MAX_REDIRECTS} redirects.`, finalUrl: current };
  } catch (error) {
    if (error instanceof BlockedAddressError) {
      return { kind: 'blocked', code: error.code, message: error.message, finalUrl: current };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) return { kind: 'failed', code: 'timeout', message: `No complete response within ${timeoutMs} ms.`, finalUrl: current };
    if (message === 'too_large') return { kind: 'failed', code: 'too_large', message: `Larger than ${maxBytes} bytes.`, finalUrl: current };
    return { kind: 'failed', code: 'network_error', message: message.slice(0, 500), finalUrl: current };
  } finally {
    clearTimeout(timer);
  }
}
