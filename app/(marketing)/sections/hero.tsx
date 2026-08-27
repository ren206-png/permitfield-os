import Link from 'next/link';

// COPY_DECK.md §2. Headline/subhead ground in MARKETING_CAPABILITY_LEDGER.md
// §1 (intake/tracking, SHIPPED) and §2 (AI extraction, SHIPPED --
// deliberately worded "cut down manual data entry," not "auto-fills your
// application," since §2's own evidence forbids claiming compliance or
// completeness the model doesn't assert).
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative gradient background -- purely visual, no content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50 via-sky-50/60 to-white"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-10rem] -z-10 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-300/30 to-sky-300/30 blur-3xl"
      />

      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-28">
        <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          Built for Canadian trade contractors
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-6xl">
          Permit applications,{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-sky-500 bg-clip-text text-transparent">
            organized from intake to filing.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600">
          PermitField OS keeps your permit applications, documents, and filing
          status in one place — with AI-assisted extraction to cut down manual
          data entry. Built for contractors working in Toronto and Calgary
          today.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="rounded-md bg-gradient-to-r from-indigo-600 to-sky-500 px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-200 transition hover:shadow-lg hover:shadow-indigo-300"
          >
            Create your account
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
