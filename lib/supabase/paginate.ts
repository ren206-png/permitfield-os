// Health-check audit finding: this exact "loop .range() until a short page
// comes back" paginator was independently duplicated in app/admin/page.tsx
// and lib/jurisdictions/public-directory.ts to work around the same
// underlying issue -- PostgREST's default `db max rows` config silently caps
// a single .select() response at 1000 rows, with no error and no indication
// anything was cut off. Extracted here as the one shared implementation so
// a future fix/change to the pagination strategy doesn't need to be applied
// in three places by hand. Callers must supply a deterministic ORDER BY (or
// otherwise not care about row order, e.g. because the result is only used
// to build a Set) -- .range() pagination without one can skip or repeat rows
// across pages.
export async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  errorContext: string
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await runPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Failed to load ${errorContext}: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  return rows;
}
