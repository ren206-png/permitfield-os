export default function ClientDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="h-6 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="mt-1.5 h-4 w-32 animate-pulse rounded bg-zinc-100" />
      </div>
      <div className="h-24 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      <div>
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="mt-2 h-16 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      </div>
      <div>
        <div className="h-4 w-20 animate-pulse rounded bg-zinc-200" />
        <div className="mt-2 h-16 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      </div>
    </div>
  );
}
