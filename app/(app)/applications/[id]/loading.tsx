// Streamed while ApplicationPage's data fetch is in flight (signed URLs,
// extraction, findings, signatures: 2-3 s on production). Without it a click
// on an application in the list kept the list on screen until the page was
// ready, which looked like the site had frozen. Same layout as the page's
// header, details card and first panels, so nothing jumps when it swaps in.
function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="h-4 w-36 animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-3 w-full animate-pulse rounded bg-zinc-100" />
        ))}
      </div>
    </div>
  );
}

export default function ApplicationLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading application">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="h-6 w-64 animate-pulse rounded bg-zinc-200" />
            <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-zinc-100" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-28 animate-pulse rounded-full bg-zinc-100" />
            <div className="h-6 w-36 animate-pulse rounded-full bg-zinc-100" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200" />
            </div>
          ))}
        </div>
      </div>

      <PanelSkeleton rows={4} />
      <PanelSkeleton rows={3} />
    </div>
  );
}
