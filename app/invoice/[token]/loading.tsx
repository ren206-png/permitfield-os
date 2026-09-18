// Mirrors app/estimate/[token]/loading.tsx's shape exactly -- see that
// file's header comment for why this route needs its own skeleton rather
// than relying on a shared one.
export default function InvoiceTokenLoading() {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="h-6 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="h-6 w-16 animate-pulse rounded-full bg-zinc-200" />
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      <div className="mt-6 h-24 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
    </div>
  );
}
