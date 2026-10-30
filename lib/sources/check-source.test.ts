import { describe, expect, it } from 'vitest';
import { buildCapture, MAX_CAPTURE_CHUNKS, sha256Hex, SourceCaptureSchema } from './capture';
import { checkSource, type Fetcher } from './check-source';
import type { FetchSourceResult } from './fetch-source';

const ok = (body: string, contentType = 'text/html'): FetchSourceResult => ({
  kind: 'ok',
  status: 200,
  finalUrl: 'https://example.ca/fees',
  contentType,
  bytes: Buffer.from(body),
  etag: '"v1"',
  lastModified: null,
});
const fetcherReturning = (result: FetchSourceResult): Fetcher => async () => result;

describe('checkSource', () => {
  it('stages a capture with a hash of the normalised text, locators and chunks', async () => {
    const result = await checkSource('https://example.ca/fees', { etag: null, lastModified: null }, fetcherReturning(ok('<h1>Fees</h1><p>$10 per m2</p>')));
    expect(result.result).toBe('fetched');
    if (result.result !== 'fetched') return;
    expect(result.capture.text).toBe('[Fees]\n$10 per m2');
    expect(result.capture.content_sha256).toBe(sha256Hex('[Fees]\n$10 per m2'));
    expect(result.capture.chunks).toEqual([{ index: 0, locator: 'Fees', content: '$10 per m2' }]);
    expect(SourceCaptureSchema.safeParse(result.capture).success).toBe(true);
  });

  it('markup-only changes give the same hash (a changed page is not a changed rule)', async () => {
    const a = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok('<h1>Fees</h1><p data-token="abc">$10</p>')));
    const b = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok('<h1 class="x">Fees</h1><p data-token="xyz">$10</p><script>t=2</script>')));
    expect(a.result === 'fetched' && b.result === 'fetched' && a.capture.content_sha256 === b.capture.content_sha256).toBe(true);
  });

  it('passes the last validators and reports a 304 as not_modified', async () => {
    let seen: unknown;
    const result = await checkSource('u', { etag: '"v1"', lastModified: 'Mon, 01 Sep 2026 00:00:00 GMT' }, async (_url, options) => {
      seen = options;
      return { kind: 'not_modified', status: 304, finalUrl: 'u', etag: '"v1"', lastModified: null };
    });
    expect(seen).toMatchObject({ etag: '"v1"', lastModified: 'Mon, 01 Sep 2026 00:00:00 GMT' });
    expect(result).toMatchObject({ result: 'not_modified', httpStatus: 304 });
  });

  it('a network failure is a failed check, never an exception', async () => {
    const result = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning({ kind: 'failed', code: 'http_error', message: 'HTTP 503.', status: 503 }));
    expect(result).toMatchObject({ result: 'failed', errorCode: 'http_error', httpStatus: 503 });
  });

  it('a guard refusal is blocked', async () => {
    const result = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning({ kind: 'blocked', code: 'address_not_public', message: 'no' }));
    expect(result).toMatchObject({ result: 'blocked', errorCode: 'address_not_public' });
  });

  it('unsupported content is blocked; unreadable content fails', async () => {
    expect(await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok('x', 'application/msword')))).toMatchObject({
      result: 'blocked',
      errorCode: 'unsupported_content',
    });
    expect(await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok('<script>x</script>')))).toMatchObject({
      result: 'failed',
      errorCode: 'empty_text',
    });
  });
});

describe('sites that block automated checks', () => {
  const incapsula =
    '<html>\n<head>\n<META NAME="robots" CONTENT="noindex,nofollow">\n<script src="/_Incapsula_Resource?SWJIYLWA=5074a744">\n</script>\n<body>\n</body></html>';

  it('an anti-bot challenge page is blocked with upload advice, not "no readable text"', async () => {
    const result = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok(incapsula)));
    expect(result).toMatchObject({ result: 'blocked', errorCode: 'bot_challenge', httpStatus: 200 });
    if (result.result === 'blocked') expect(result.errorMessage).toContain('Upload the official copy');
    const cloudflare = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/x"></script></body></html>';
    expect(await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok(cloudflare)))).toMatchObject({ errorCode: 'bot_challenge' });
  });

  it('a real page that merely mentions the words is still captured', async () => {
    const page = '<h1>Fees</h1><p>Our site uses a "Just a moment" banner and _Incapsula_Resource is a word here.</p>';
    expect((await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(ok(page)))).result).toBe('fetched');
  });

  it('a 403 or 429 suggests an upload; other HTTP errors do not', async () => {
    const http = (status: number): FetchSourceResult => ({ kind: 'failed', code: 'http_error', message: `HTTP ${status}.`, status, finalUrl: 'u' });
    const refused = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(http(403)));
    expect(refused).toMatchObject({ result: 'failed', errorCode: 'http_error', httpStatus: 403 });
    if (refused.result === 'failed') expect(refused.errorMessage).toMatch(/^HTTP 403\. The site may block automated checks\./);
    const missing = await checkSource('u', { etag: null, lastModified: null }, fetcherReturning(http(404)));
    if (missing.result === 'failed') expect(missing.errorMessage).toBe('HTTP 404.');
  });
});

describe('buildCapture', () => {
  it('refuses oversize content instead of truncating it', () => {
    const sections = Array.from({ length: MAX_CAPTURE_CHUNKS + 1 }, (_, i) => ({ locator: `p. ${i + 1}`, text: `Page ${i + 1} text.` }));
    expect(buildCapture('pdf', 'v', sections)).toMatchObject({ ok: false, code: 'too_large' });
  });
});
