import Link from 'next/link';

// COPY_DECK.md §2. Headline/subhead ground in MARKETING_CAPABILITY_LEDGER.md
// §1 (intake/tracking, SHIPPED) and §2 (AI extraction, SHIPPED --
// deliberately worded "cut down manual data entry," not "auto-fills your
// application," since §2's own evidence forbids claiming compliance or
// completeness the model doesn't assert).
//
// PHASE 1 (LP workstream, see LP_PHASE_0_FINDINGS.md §0.2): subhead no
// longer names cities in prose. It states the jurisdiction count (verified
// against the coverage registry -- supabase/seed.sql:14-27, read live by
// sections/coverage.tsx via lib/jurisdictions/public-directory.ts as of the
// jurisdiction-expansion scoping follow-up, no longer a hardcoded array) and
// links to #coverage, where tiers are disclosed.
//
// No jurisdiction count in this sentence either, for the same reason: a
// literal "4" here would be exactly the same kind of drift risk the
// JURISDICTIONS array was, just smaller -- cheaper to drop the number than
// to make this component async just to fetch a count for one word.
export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative glow -- purely visual, no content. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.28),transparent_60%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-40 -z-10 h-[30rem] w-[44rem] max-w-full -translate-x-1/2 rounded-full bg-violet-600/20 blur-3xl" />

      <div className="mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
        <div className="mb-6 flex items-center justify-center gap-4 text-sm font-medium text-indigo-300">
          <span aria-hidden="true" className="hidden h-px w-16 bg-gradient-to-r from-transparent to-indigo-400 sm:block" />
          Built for Canadian trade contractors
          <span aria-hidden="true" className="hidden h-px w-16 bg-gradient-to-l from-transparent to-indigo-400 sm:block" />
        </div>
        <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl sm:leading-[1.05]">
          Permit applications,{' '}
          <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-sky-300 bg-clip-text text-transparent">
            organized from intake to filing.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          PermitField OS keeps your permit applications, documents, and filing
          status in one place — with AI-assisted extraction to cut down manual
          data entry. Built for contractors in the Canadian jurisdictions we{' '}
          <a href="#coverage" className="underline decoration-slate-500 underline-offset-2 hover:text-white">
            cover today
          </a>
          .
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href={signedIn ? '/applications' : '/login?mode=sign-up'}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/50 transition hover:brightness-110"
          >
            {signedIn ? 'Open the app' : 'Create your account'}
          </Link>
          <a href="#how-it-works" className="rounded-full border border-white/20 px-7 py-3 text-sm font-medium text-white transition hover:bg-white/5">
            See how it works
          </a>
        </div>

        <HeroIllustration />
      </div>
    </section>
  );
}

// An illustration of the tracking view, not a screenshot: the three statuses
// are the real application states, and no customer data or figures appear.
function HeroIllustration() {
  const rows = [
    { name: 'Tenant improvement', status: 'Draft', tone: 'bg-slate-500/20 text-slate-300' },
    { name: 'Electrical service upgrade', status: 'Documents ready', tone: 'bg-indigo-500/20 text-indigo-200' },
    { name: 'Commercial renovation', status: 'Submitted', tone: 'bg-emerald-500/20 text-emerald-300' },
  ];
  return (
    <div
      role="img"
      aria-label="Illustration of the PermitField OS application tracker showing applications in draft, documents-ready and submitted states"
      className="relative mx-auto mt-16 max-w-4xl rounded-3xl border border-indigo-400/20 bg-gradient-to-b from-indigo-500/10 to-transparent p-3 shadow-2xl shadow-indigo-950/60 sm:p-4"
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f2c] text-left">
        <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 text-xs text-slate-500">Applications</span>
        </div>
        <div className="grid sm:grid-cols-[11rem_1fr]">
          <div className="hidden space-y-2 border-r border-white/5 p-4 text-xs text-slate-500 sm:block">
            <div className="rounded-md bg-indigo-500/15 px-3 py-2 text-indigo-200">Applications</div>
            <div className="px-3 py-2">Documents</div>
            <div className="px-3 py-2">Coverage</div>
            <div className="px-3 py-2">Team</div>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {rows.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500/40 to-violet-500/40" />
                  <span className="text-sm font-medium text-white">{row.name}</span>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${row.tone}`}>{row.status}</span>
              </div>
            ))}
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-indigo-400/30 px-4 py-3 text-xs text-indigo-200">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              Key fields extracted from your uploads, ready for your review
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
