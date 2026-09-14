'use client';

// Layout-wide error boundary for every route under app/(app)/ -- before this
// file existed, an uncaught throw from any page in this segment (e.g. any
// of this codebase's many "if (error) throw new Error(...)" data-fetch
// guards) fell through to Next's generic default error UI instead of
// anything branded. A single file here catches all of them; individual
// routes don't need their own error.tsx unless a route wants a distinctly
// different recovery message.
//
// Client component by Next's own convention (error.tsx must be, since it
// needs onClick for the retry button) -- `error` is whatever was thrown
// server-side, already stripped of anything sensitive by Next before it
// reaches the client in production.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-red-300 bg-white p-10 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-600">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
      >
        Try again
      </button>
    </div>
  );
}
