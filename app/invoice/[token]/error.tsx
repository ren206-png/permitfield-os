'use client';

// Mirrors app/estimate/[token]/error.tsx's shape and reasoning exactly --
// see that file's header comment.
export default function InvoiceTokenError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-600">
          We couldn&apos;t load this invoice right now. Please try again in a moment.
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
