// Next's App Router streams this automatically while DashboardPage's async
// Server Component body (five Promise.all'd RPC calls) is still in flight --
// see that page's own header comment for why this route gets an explicit
// skeleton rather than relying on a blank screen.
function PanelSkeleton() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="h-3 w-full animate-pulse rounded bg-zinc-100" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div>
      <div className="h-6 w-40 animate-pulse rounded bg-zinc-200" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <PanelSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
