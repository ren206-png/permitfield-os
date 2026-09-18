// Health-check audit follow-up: lib/ai/embed.ts previously had zero test
// coverage (confirmed via `grep -rl "from '@/lib/ai/embed'\|embed.ts"
// **/*.test.ts` returning no matches before this file existed). This file
// exists specifically to cover the AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS)
// addition from that same audit -- an unbounded fetch() would otherwise hang
// the caller (and any Inngest step wrapping it) indefinitely on a stalled
// Voyage connection; embedText() now catches the resulting TimeoutError and
// rethrows a specific, actionable message instead of letting a generic abort
// error surface.
//
// Mocks global.fetch (vi.stubGlobal) rather than hitting the real Voyage API
// -- a thin REST wrapper like this has no DB/Supabase dependency to run
// afoul of this repo's "no test mocks Supabase" convention
// (lib/entitlements/index.test.ts's own header), so mocking the one external
// call this module makes is the natural, and only, way to unit-test it in
// isolation. The timeout case in particular deliberately does NOT wait for a
// real 30s AbortSignal.timeout to fire -- it simulates fetch() rejecting with
// the same DOMException shape (name: 'TimeoutError') a real timeout produces,
// which is all embedText()'s catch block branches on.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, EXTERNAL_API_TIMEOUT_MS } from './config';
import { embedText, toPgvectorLiteral } from './embed';

function makeEmbedding(length: number): number[] {
  return Array.from({ length }, (_, i) => i / length);
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('embedText', () => {
  beforeEach(() => {
    vi.stubEnv('VOYAGE_API_KEY', 'voyage-test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('throws if VOYAGE_API_KEY is not set', async () => {
    vi.stubEnv('VOYAGE_API_KEY', '');
    await expect(embedText('hello world', 'query')).rejects.toThrow(
      'VOYAGE_API_KEY is not set; cannot call Voyage embeddings API.'
    );
  });

  test('throws on empty text without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedText('   ', 'query')).rejects.toThrow('embedText requires non-empty text.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('calls the Voyage endpoint with the expected request shape and returns the embedding', async () => {
    const embedding = makeEmbedding(EMBEDDING_DIMENSIONS);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [{ object: 'embedding', embedding, index: 0 }],
        model: EMBEDDING_MODEL_ID,
        usage: { total_tokens: 3 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedText('hello world', 'document');

    expect(result).toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer voyage-test-key');
    expect(JSON.parse(init.body)).toEqual({
      input: 'hello world',
      model: EMBEDDING_MODEL_ID,
      input_type: 'document',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('throws a dimension-mismatch error if the returned embedding is the wrong length', async () => {
    const wrongLengthEmbedding = makeEmbedding(EMBEDDING_DIMENSIONS - 1);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          object: 'list',
          data: [{ object: 'embedding', embedding: wrongLengthEmbedding, index: 0 }],
          model: EMBEDDING_MODEL_ID,
          usage: { total_tokens: 3 },
        })
      )
    );

    await expect(embedText('hello world', 'query')).rejects.toThrow(
      `Voyage embeddings API returned a ${EMBEDDING_DIMENSIONS - 1}-dimension vector; expected ${EMBEDDING_DIMENSIONS}`
    );
  });

  test('throws on a non-ok response, including the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 }))
    );

    await expect(embedText('hello world', 'query')).rejects.toThrow('Voyage embeddings API returned 429');
  });

  test('translates an AbortSignal.timeout rejection into a specific timeout error', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

    await expect(embedText('hello world', 'query')).rejects.toThrow(
      `Voyage embeddings API call timed out after ${EXTERNAL_API_TIMEOUT_MS}ms.`
    );
  });

  test('rethrows a non-timeout transport error unchanged', async () => {
    const networkError = new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    await expect(embedText('hello world', 'query')).rejects.toThrow('fetch failed: getaddrinfo ENOTFOUND');
  });
});

describe('toPgvectorLiteral', () => {
  test('formats a pgvector literal string from an embedding array', () => {
    expect(toPgvectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });

  test('formats an empty embedding array', () => {
    expect(toPgvectorLiteral([])).toBe('[]');
  });
});
