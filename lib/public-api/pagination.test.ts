import { describe, it, expect } from 'vitest';
import { buildPage, DEFAULT_PAGE_LIMIT, isUuid, MAX_PAGE_LIMIT, parsePageParams } from './pagination';

function parse(query: string) {
  return parsePageParams(new URLSearchParams(query));
}

describe('parsePageParams', () => {
  it('defaults when nothing is given', () => {
    expect(parse('')).toEqual({ ok: true, page: { limit: DEFAULT_PAGE_LIMIT, offset: 0 } });
  });

  it('accepts in-range values', () => {
    expect(parse(`limit=${MAX_PAGE_LIMIT}&offset=250`)).toEqual({
      ok: true,
      page: { limit: MAX_PAGE_LIMIT, offset: 250 },
    });
    expect(parse('limit=1')).toEqual({ ok: true, page: { limit: 1, offset: 0 } });
  });

  it('rejects out-of-range or non-integer values', () => {
    for (const query of [
      'limit=0',
      `limit=${MAX_PAGE_LIMIT + 1}`,
      'limit=-5',
      'limit=abc',
      'limit=1.5',
      'limit=',
      'offset=-1',
      'offset=1e3',
      'offset=99999999999999999999',
    ]) {
      expect(parse(query).ok, query).toBe(false);
    }
  });
});

describe('buildPage', () => {
  it('trims the lookahead row and reports has_more', () => {
    expect(buildPage([1, 2, 3], { limit: 2, offset: 4 })).toEqual({
      data: [1, 2],
      pagination: { limit: 2, offset: 4, has_more: true },
    });
  });

  it('reports no more rows on a short page', () => {
    expect(buildPage([1, 2], { limit: 2, offset: 0 })).toEqual({
      data: [1, 2],
      pagination: { limit: 2, offset: 0, has_more: false },
    });
    expect(buildPage([], { limit: 50, offset: 0 }).pagination.has_more).toBe(false);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs and rejects anything else', () => {
    expect(isUuid('40000000-0000-0000-0000-00000000000a')).toBe(true);
    expect(isUuid('40000000-0000-0000-0000-00000000000A')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid("40000000-0000-0000-0000-00000000000a' or 1=1")).toBe(false);
  });
});
