'use client';

// Route-local error boundary for the customer-facing estimate portal --
// there is no app/estimate/[token]/layout.tsx (and no shared app/(app)/
// error.tsx applies here, that one only covers routes under app/(app)/),
// so before this file existed an uncaught throw from page.tsx (e.g. its
// "Failed to load estimate: ..." guard) fell through to Next's generic
// default error UI instead of anything branded, for a page a customer with
// no account and no other context in this app might land on cold from an
// email link. Same client-component + reset() shape as
// app/(app)/error.tsx, deliberately generic copy -- this page's own
// notFound() already collapses every "bad token" reason to a 404 (see
// page.tsx's header comment), so this boundary only ever catches a genuine
// unexpected failure, not an expected denial.
export default function EstimateTokenError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-600">
          We couldn&apos;t load this estimate right now. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
