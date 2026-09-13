import type { PanelRow } from '@/lib/dashboard/labels';

interface DashboardPanelProps {
  title: string;
  rows: PanelRow[];
  /** Shown instead of the row list when every row's count is 0 -- a real,
   * valid answer per 20260806000028_dashboard_queries.sql's own header
   * comment ("a 0-row result [is] the empty state ... not a permission
   * failure"), not treated as an error or hidden away. */
  emptyMessage: string;
}

// One panel = one of the five dashboard_*() SQL functions
// (20260806000028_dashboard_queries.sql). Deliberately a plain label+count
// list, not a chart -- no charting library exists anywhere in this
// repo's dependencies, and reaching for one for a single dashboard would be
// a bigger footprint than five bar-less lists warrant. The width of each
// bar-less row is still proportional to its share of the panel's own total
// (a lightweight CSS-only bar), giving an at-a-glance shape without a
// dependency.
export function DashboardPanel({ title, rows, emptyMessage }: DashboardPanelProps) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {total === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-zinc-600">{row.label}</span>
                <span className="font-medium text-zinc-900">{row.count}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
                <div
                  className="h-1.5 rounded-full bg-zinc-900"
                  style={{ width: `${total > 0 ? (row.count / total) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// dashboard_requirements_summary() returns three independent scalars, not
// mutually-exclusive group-by buckets -- `with_warnings` is itself a SUBSET
// of `matched` (that migration's own comment), so summing all three and
// deriving a proportional bar width the way DashboardPanel does above would
// double-count and mislead. Rendered as plain side-by-side stats instead.
export function DashboardStatsPanel({
  title,
  stats,
}: {
  title: string;
  stats: { label: string; count: number }[];
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-lg font-semibold text-zinc-900">{stat.count}</p>
            <p className="text-xs text-zinc-500">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
