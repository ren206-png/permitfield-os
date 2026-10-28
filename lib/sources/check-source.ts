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
    return {
      result: fetched.kind,
      errorCode: fetched.code,
      errorMessage: fetched.message,
      httpStatus: fetched.status ?? null,
      finalUrl: fetched.finalUrl ?? null,
      contentType: null,
      byteLength: null,
    };
  }

  const base = { httpStatus: fetched.status, finalUrl: fetched.finalUrl, contentType: fetched.contentType, byteLength: fetched.bytes.length };
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
