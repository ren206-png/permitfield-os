import Image from 'next/image';
import Link from 'next/link';

// COPY_DECK.md §2. Headline/subhead ground in MARKETING_CAPABILITY_LEDGER.md
// §1 (intake/tracking, SHIPPED) and §2 (AI extraction, SHIPPED --
// deliberately worded "cut down manual data entry," not "auto-fills your
// application," since §2's own evidence forbids claiming compliance or
// completeness the model doesn't assert).
//
// PHASE 1 (LP workstream, see LP_PHASE_0_FINDINGS.md §0.2): subhead no
// longer names cities in prose. It links to #coverage, where tiers are
// disclosed. No jurisdiction count in this sentence either: a literal number
// here would drift from the coverage registry, which sections/coverage.tsx
// and sections/city-strip.tsx read live.
//
// The three notes under the buttons are approved claims 2, 3 and 4 of the
// ledger (extraction with human review; official forms pre-filled; data
// isolated per organization), worded no stronger than the ledger allows.
const NOTES = ['AI extraction you review', 'Official city forms, pre-filled', 'Data isolated per organization'];

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      {/* Blueprint grid, fading out toward the edges -- purely visual. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(21_23_28/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(21_23_28/0.05)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_60%_40%,black,transparent)]"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pb-28">
        <div>
          <p className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-clay">
            <span aria-hidden="true" className="h-px w-8 bg-clay" />
            Built for Canadian trade contractors
          </p>
          <h1 className="mt-6 font-display text-[3.25rem] leading-[1.02] tracking-tight sm:text-7xl">
            Permit applications, organized <em className="text-clay">from intake to filing.</em>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink/65">
            PermitField OS keeps your permit applications, documents, and filing
            status in one place — with AI-assisted extraction to cut down manual
            data entry. Built for contractors in the Canadian jurisdictions we{' '}
            <a href="#coverage" className="text-ink underline decoration-ink/25 underline-offset-4 transition hover:decoration-ink">
              cover today
            </a>
            .
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link
              href={signedIn ? '/applications' : '/login?mode=sign-up'}
              className="group inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-sm font-medium text-paper shadow-sm transition hover:bg-ink/85"
            >
              {signedIn ? 'Open the app' : 'Create your account'}
              <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span>
            </Link>
            <a href="#how-it-works" className="text-sm font-medium text-ink/70 underline decoration-ink/20 underline-offset-4 transition hover:text-ink hover:decoration-ink">
              See how it works
            </a>
          </div>
          <ul className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-sm text-ink/65">
            {NOTES.map((note) => (
              <li key={note} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-clay" />
                {note}
              </li>
            ))}
          </ul>
        </div>

        <HeroShots />
      </div>
    </section>
  );
}

// Two real captures of the running app (the same files How it works uses,
// MARKETING_CAPABILITY_LEDGER.md's screenshot rule), laid over each other
// like documents on a desk. Sample data only.
function HeroShots() {
  return (
    <div className="relative mx-auto w-full max-w-xl pb-16 lg:max-w-none lg:pb-20">
      <div className="rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgb(21_23_28/0.06),0_24px_60px_-20px_rgb(21_23_28/0.25)] ring-1 ring-line sm:p-2.5">
        <Image
          src="/showcase/tracker.jpg"
          width={1832}
          height={1080}
          alt="The applications list showing each permit application with its status and coverage level"
          sizes="(min-width: 1024px) 560px, 100vw"
          priority
          className="h-auto w-full rounded-xl"
        />
      </div>
      <div className="absolute -bottom-2 -left-3 w-[78%] rounded-xl bg-white p-1.5 shadow-[0_1px_2px_rgb(21_23_28/0.06),0_20px_50px_-16px_rgb(21_23_28/0.3)] ring-1 ring-line sm:-left-8 lg:-left-12">
        <Image
          src="/showcase/extraction.jpg"
          width={1824}
          height={588}
          alt="The extraction summary: applicant, licence number, project area, amps, job value and scope, each with a confidence score"
          sizes="(min-width: 1024px) 440px, 78vw"
          className="h-auto w-full rounded-lg"
        />
      </div>
    </div>
  );
}
