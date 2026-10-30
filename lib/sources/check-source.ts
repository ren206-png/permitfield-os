import { buildCapture, type SourceCapture } from './capture';
import { fetchSource, type FetchSourceOptions, type FetchSourceResult } from './fetch-source';
import { loadSourceDocument } from './loaders';

// Gate 6.3: one source check, from URL to the arguments record_source_check
// (migration 20260806000094) takes. Pure apart from the injected fetcher, so
// every outcome -- blocked URL, HTTP failure, 304, unsupported or empty
// content, oversize text, a good capture -- is unit-tested without network.

export type CheckResult =
  | {
      result: 'fetched';
      httpStatus: number;
      finalUrl: string;
      contentType: string;
      byteLength: number;
      etag: string | null;
      lastModified: string | null;
      capture: SourceCapture;
    }
  | { result: 'not_modified'; httpStatus: 304; finalUrl: string; etag: string | null; lastModified: string | null }
  | {
      result: 'failed' | 'blocked';
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
      finalUrl: string | null;
      contentType: string | null;
      byteLength: number | null;
    };

export type Fetcher = (url: string, options: FetchSourceOptions) => Promise<FetchSourceResult>;

// Some city sites sit behind anti-bot services that refuse automated
// requests or answer them with a script challenge instead of the page
// (vancouver.ca: Cloudflare 403; ottawa.ca: an Imperva/Incapsula page, 2026-10-30).
// Retrying never helps; an admin uploads the official copy instead
// (record_source_upload, migration 20260806000100), so the message says so.
export const UPLOAD_INSTEAD = "If the page opens in a browser, download it and use \"Upload the official copy\" on this source's page.";
// The challenge scripts themselves, not words a real page could contain.
// Cloudflare also injects a challenge-platform script into ordinary pages
// (JavaScript Detections), so a marker alone is not enough: a challenge
// page also has almost no readable text of its own.
const CHALLENGE_MARKERS = [
  /<script[^>]+src=["'][^"']*_Incapsula_Resource/i,
  /<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform\//i,
];
const MAX_CHALLENGE_PAGE_BYTES = 64 * 1024;
const MAX_CHALLENGE_TEXT_CHARS = 500;

function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function looksLikeBotChallenge(bytes: Buffer, contentType: string): boolean {
  if (bytes.length > MAX_CHALLENGE_PAGE_BYTES || !/html/i.test(contentType)) return false;
  const html = bytes.toString('utf8');
  return CHALLENGE_MARKERS.some((m) => m.test(html)) && visibleTextLength(html) <= MAX_CHALLENGE_TEXT_CHARS;
}

export async function checkSource(
  url: string,
  previous: { etag: string | null; lastModified: string | null },
  fetcher: Fetcher = fetchSource
): Promise<CheckResult> {
  const fetched = await fetcher(url, { etag: previous.etag, lastModified: previous.lastModified });

  if (fetched.kind === 'not_modified') {
    return { result: 'not_modified', httpStatus: 304, finalUrl: fetched.finalUrl, etag: fetched.etag, lastModified: fetched.lastModified };
  }
  if (fetched.kind !== 'ok') {
    const refused = fetched.status === 403 || fetched.status === 429;
    return {
      result: fetched.kind,
      errorCode: fetched.code,
      errorMessage: refused ? `${fetched.message} The site may block automated checks. ${UPLOAD_INSTEAD}` : fetched.message,
      httpStatus: fetched.status ?? null,
      finalUrl: fetched.finalUrl ?? null,
      contentType: null,
      byteLength: null,
    };
  }

  const base = { httpStatus: fetched.status, finalUrl: fetched.finalUrl, contentType: fetched.contentType, byteLength: fetched.bytes.length };
  if (looksLikeBotChallenge(fetched.bytes, fetched.contentType)) {
    return {
      result: 'blocked',
      errorCode: 'bot_challenge',
      errorMessage: `The site answered with an anti-bot challenge instead of the page. ${UPLOAD_INSTEAD}`,
      ...base,
    };
  }
  const loaded = await loadSourceDocument(fetched.bytes, fetched.contentType);
  if (!loaded.ok) {
    // Unsupported or mismatched content is refused (blocked); unreadable
    // content is a failure. Neither touches the published revision.
    const result = loaded.code === 'unsupported_content' || loaded.code === 'signature_mismatch' ? 'blocked' : 'failed';
    return { result, errorCode: loaded.code, errorMessage: loaded.message, ...base };
  }

  const built = buildCapture(loaded.loader, loaded.loaderVersion, loaded.sections);
  if (!built.ok) return { result: 'failed', errorCode: built.code, errorMessage: built.message, ...base };

  return { result: 'fetched', ...base, etag: fetched.etag, lastModified: fetched.lastModified, capture: built.capture };
}
