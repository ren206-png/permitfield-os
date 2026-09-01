import Link from 'next/link';

// COPY_DECK.md §2. Headline/subhead ground in MARKETING_CAPABILITY_LEDGER.md
// §1 (intake/tracking, SHIPPED) and §2 (AI extraction, SHIPPED --
// deliberately worded "cut down manual data entry," not "auto-fills your
// application," since §2's own evidence forbids claiming compliance or
// completeness the model doesn't assert).
//
// PHASE 1 (LP workstream, see LP_PHASE_0_FINDINGS.md §0.2): subhead no
// longer names cities in prose. It states the jurisdiction count (verified
// against the coverage registry -- supabase/seed.sql:14-27, mirrored in
// sections/coverage.tsx's JURISDICTIONS array) and links to #coverage,
// where tiers are disclosed. Prevents the copy from going stale the next
// time coverage changes without someone remembering to edit this file.
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative gradient background -- purely visual, no content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50 via-sky-50/60 to-white dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-10rem] -z-10 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-300/30 to-sky-300/30 blur-3xl dark:from-indigo-500/20 dark:to-sky-500/10"
      />

      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-28">
        <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          Built for Canadian trade contractors
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-6xl dark:text-white">
          Permit applications,{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">
            organized from intake to filing.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          PermitField OS keeps your permit applications, documents, and filing
          status in one place — with AI-assisted extraction to cut down manual
          data entry. Built for contractors in the 4 Canadian jurisdictions we{' '}
          <a
            href="#coverage"
            className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
          >
            cover today
          </a>
          .
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="rounded-md bg-gradient-to-r from-indigo-600 to-sky-500 px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-200 transition hover:shadow-lg hover:shadow-indigo-300 dark:shadow-none"
          >
            Create your account
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
