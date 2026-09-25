export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export interface PageParams {
  limit: number;
  offset: number;
}

export type ParsePageResult = { ok: true; page: PageParams } | { ok: false; error: string };

function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function parsePageParams(searchParams: URLSearchParams): ParsePageResult {
  const rawLimit = searchParams.get('limit');
  const rawOffset = searchParams.get('offset');

  let limit = DEFAULT_PAGE_LIMIT;
  if (rawLimit !== null) {
    const parsed = parseNonNegativeInt(rawLimit);
    if (parsed === null || parsed < 1 || parsed > MAX_PAGE_LIMIT) {
      return { ok: false, error: `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.` };
    }
    limit = parsed;
  }

  let offset = 0;
  if (rawOffset !== null) {
    const parsed = parseNonNegativeInt(rawOffset);
    if (parsed === null) {
      return { ok: false, error: 'offset must be a non-negative integer.' };
    }
    offset = parsed;
  }

  return { ok: true, page: { limit, offset } };
}

// Callers fetch limit + 1 rows; the extra row only signals has_more.
export function buildPage<T>(rows: T[], page: PageParams) {
  const hasMore = rows.length > page.limit;
  return {
    data: hasMore ? rows.slice(0, page.limit) : rows,
    pagination: { limit: page.limit, offset: page.offset, has_more: hasMore },
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
