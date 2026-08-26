import Link from 'next/link';

// COPY_DECK.md §2. Headline/subhead ground in MARKETING_CAPABILITY_LEDGER.md
// §1 (intake/tracking, SHIPPED) and §2 (AI extraction, SHIPPED --
// deliberately worded "cut down manual data entry," not "auto-fills your
// application," since §2's own evidence forbids claiming compliance or
// completeness the model doesn't assert).
export function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
        Permit applications, organized from intake to filing.
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
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
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
    </section>
  );
}
