// Health-check audit follow-up: lib/ai/gemini/client.ts previously had zero
// test coverage (its own header explicitly noted "ZERO LIVE CALL SITES as of
// this sub-phase," and confirmed via grep that no *.test.ts file referenced
// it). This file exists specifically to cover the
// AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS) addition from that same
// audit, mirroring lib/ai/embed.test.ts's identical coverage for the Voyage
// client -- same shape of bug (an unbounded fetch could hang a caller
// indefinitely), same fix (catch the TimeoutError, rethrow a specific
// message), same test strategy (mock global.fetch, simulate the timeout
// rejection directly rather than waiting out a real 30s timer).
//
// Imports './client' via a relative path, same convention every other
// colocated live/unit test in this repo uses for the module directly under
// test (lib/audit/log.live.test.ts's `from './log'`,
// lib/bridge/client-portal.live.test.ts's `from './client-portal'`). Also
// added to eslint.config.mjs's geminiClientRestriction ignores, mirroring
// that rule's own header comment ("If a future test needs one, add it to
// `ignores` alongside lib/ai/router.ts at that time") -- this is that time.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EXTERNAL_API_TIMEOUT_MS, GEMINI_ASSISTANT_MODEL_ID } from '../config';
import { generateContent } from './client';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('generateContent', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('throws if GEMINI_API_KEY is not set', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(generateContent('system', 'user prompt')).rejects.toThrow(
      'GEMINI_API_KEY is not set; cannot call the Gemini API.'
    );
  });

  test('throws on an empty userPrompt without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateContent('system', '   ')).rejects.toThrow(
      'generateContent requires a non-empty userPrompt.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('calls the Gemini endpoint with the expected request shape and returns parsed text/usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'the response text' }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateContent('system prompt', 'user prompt');

    expect(result.text).toBe('the response text');
    expect(result.inputTokenCount).toBe(12);
    expect(result.outputTokenCount).toBe(34);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ASSISTANT_MODEL_ID}:generateContent`
    );
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('gemini-test-key');
    expect(JSON.parse(init.body)).toEqual({
      systemInstruction: { parts: [{ text: 'system prompt' }] },
      contents: [{ role: 'user', parts: [{ text: 'user prompt' }] }],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('defaults missing usage counts to zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }))
    );

    const result = await generateContent('system', 'user prompt');
    expect(result.inputTokenCount).toBe(0);
    expect(result.outputTokenCount).toBe(0);
  });

  test('throws if the response contains no candidate text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ candidates: [] })));

    await expect(generateContent('system', 'user prompt')).rejects.toThrow(
      'Gemini generateContent API response contained no candidate text.'
    );
  });

  test('throws on a non-ok response, including the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'quota exceeded' }, { ok: false, status: 429 }))
    );

    await expect(generateContent('system', 'user prompt')).rejects.toThrow('Gemini generateContent API returned 429');
  });

  test('translates an AbortSignal.timeout rejection into a specific timeout error', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

    await expect(generateContent('system', 'user prompt')).rejects.toThrow(
      `Gemini generateContent API call timed out after ${EXTERNAL_API_TIMEOUT_MS}ms.`
    );
  });

  test('rethrows a non-timeout transport error unchanged', async () => {
    const networkError = new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    await expect(generateContent('system', 'user prompt')).rejects.toThrow('fetch failed: getaddrinfo ENOTFOUND');
  });
});
