// Streamed while ClientsPage's data fetch is in flight -- see
// app/(app)/dashboard/loading.tsx's header comment for why this route gets
// one too (a real skeleton, not a blank screen) rather than every route.
export default function ClientsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="h-6 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="h-9 w-28 animate-pulse rounded-md bg-zinc-200" />
      </div>
      <div className="mt-4 h-9 w-full animate-pulse rounded-md bg-zinc-100" />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
        ))}
      </div>
    </div>
  );
}
