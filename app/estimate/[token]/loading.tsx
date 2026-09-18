// Streamed while PublicEstimatePage's token-resolution + estimate lookup is
// in flight -- before this file existed, a slow lookup rendered nothing at
// all (page.tsx is `force-dynamic`, so there's no static shell to show in
// the meantime). Skeleton shape matches this page's own centered
// `max-w-2xl` layout rather than app/(app)/*'s sidebar-relative shells,
// since this route renders standalone with no shared app chrome.
export default function EstimateTokenLoading() {
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
