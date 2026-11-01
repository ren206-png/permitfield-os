import Image from 'next/image';

// COPY_DECK.md §3a. Each claim cites its MARKETING_CAPABILITY_LEDGER.md row:
// requirements check §20, fee estimates §21, copilot §22, permit lifecycle
// §23. The two screenshots are real captures of the running app with
// fictional sample data (the Calgary rule set and fee schedule as published
// in production), per the ledger's screenshot rule.
const SHOTS = [
  {
    title: 'Which requirements apply',
    body:
      "Each item on the city's published checklist is checked against the " +
      "project facts you confirm. Anything it can't decide stays unknown, " +
      'never "not required".',
    ledgerRef: '§20',
    shot: {
      src: '/showcase/requirements-check.jpg',
      width: 1760,
      height: 848,
      alt: 'The requirements check: 4 apply, 3 do not apply under the published rules, 3 unknown, with the project questions answered',
    },
  },
  {
    title: 'What the permit will cost',
    body:
      "A line-by-line estimate from the city's own published fee schedule, " +
      "with what isn't included spelled out.",
    ledgerRef: '§21',
    shot: {
      src: '/showcase/fee-estimate.jpg',
      width: 704,
      height: 1058,
      alt: 'A permit fee estimate of CAD 627.94 broken into the processing fee, the base fee and the Safety Codes Council fees, with the fees not included listed',
    },
  },
] as const;

const NOTES = [
  {
    title: 'Ask about an application',
    body:
      "Answers come from the application's records and the official sources " +
      "we've reviewed, quoted. It drafts cover letters and correction " +
      "responses for you to edit; it can't submit or sign.",
    ledgerRef: '§22',
  },
  {
    title: 'Track it after filing',
    body: "Record the city's status updates in its own words, permit conditions and inspections, all on the application.",
    ledgerRef: '§23',
  },
] as const;

export function BeforeYouFile() {
  return (
    <section id="before-you-file" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 lg:py-32">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-clay">Before you file</p>
          <h2 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
            Know what the city will ask for, <em className="text-clay">and what it will charge.</em>
          </h2>
        </div>

        <div className="mt-16 flex flex-col gap-20 lg:gap-24">
          {SHOTS.map((item, index) => (
            <figure
              key={item.title}
              className={`grid items-center gap-10 lg:gap-16 ${index === 0 ? 'lg:grid-cols-[1.6fr_1fr]' : 'lg:grid-cols-[1fr_1.6fr]'}`}
            >
              <div
                className={`w-full rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgb(21_23_28/0.06),0_24px_60px_-24px_rgb(21_23_28/0.22)] ring-1 ring-line sm:p-2.5 ${
                  index === 1 ? 'mx-auto max-w-sm lg:order-2' : ''
                }`}
              >
                <Image
                  src={item.shot.src}
                  width={item.shot.width}
                  height={item.shot.height}
                  alt={item.shot.alt}
                  sizes={index === 0 ? '(min-width: 1024px) 680px, 100vw' : '384px'}
                  className="h-auto w-full rounded-xl"
                />
              </div>
              <figcaption className="max-w-md">
                <h3 className="border-t border-line pt-6 font-display text-3xl tracking-tight sm:text-4xl">{item.title}</h3>
                <p className="mt-4 text-lg leading-relaxed text-ink/65">{item.body}</p>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-16 grid gap-10 border-t border-line pt-10 sm:grid-cols-2">
          {NOTES.map((note) => (
            <div key={note.title}>
              <h3 className="font-display text-2xl tracking-tight">{note.title}</h3>
              <p className="mt-2 max-w-md leading-relaxed text-ink/65">{note.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-12 max-w-2xl text-xs leading-relaxed text-ink/65">
          Requirement checks and fee estimates cover commercial tenant improvements in every city we
          list. A fee estimate comes from the published schedule; it is not the amount the city will
          charge. Screens show sample data.
        </p>
      </div>
    </section>
  );
}
