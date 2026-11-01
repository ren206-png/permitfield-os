import Image from 'next/image';

// COPY_DECK.md §3. Each step maps to a SHIPPED capability in
// MARKETING_CAPABILITY_LEDGER.md: step 1 -> §1, step 2 -> §2, step 3 -> §5
// (worded to match what the product actually does -- the contractor files,
// the product tracks status, never "we submit it for you").
const STEPS = [
  {
    title: 'Start an application.',
    shot: { src: '/showcase/new-application.jpg', width: 1424, height: 1120, alt: 'The new-application form with a jurisdiction, permit type, contractor and project details filled in' },
    body: 'Add project and jurisdiction details to create a new permit application.',
  },
  {
    title: 'Upload your documents.',
    shot: { src: '/showcase/extraction.jpg', width: 1824, height: 588, alt: 'The extraction summary: applicant, licence number, project area, amps, job value and scope, each with a confidence score' },
    body:
      "PermitField extracts key applicant, contractor, and scope details " +
      "automatically, so you're not retyping what's already in your paperwork.",
  },
  {
    title: 'Track it through to filing.',
    shot: { src: '/showcase/tracker.jpg', width: 1832, height: 1080, alt: 'The applications list showing each permit application with its status and coverage level' },
    body:
      'Watch your application move from draft to documents-ready, and mark ' +
      "it submitted once you've filed with the authority.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-clay">Three steps</p>
          <h2 className="mt-4 font-display text-5xl tracking-tight sm:text-6xl">How it works</h2>
        </div>
        <ol className="mt-16 flex flex-col gap-20 lg:mt-20 lg:gap-28">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <span className="font-display text-6xl italic leading-none text-clay/80">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-6 border-t border-line pt-6 font-display text-3xl tracking-tight sm:text-4xl">{step.title}</h3>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-ink/65">{step.body}</p>
              </div>
              <div className="rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgb(21_23_28/0.06),0_24px_60px_-24px_rgb(21_23_28/0.22)] ring-1 ring-line sm:p-2.5">
                <Image
                  src={step.shot.src}
                  width={step.shot.width}
                  height={step.shot.height}
                  alt={step.shot.alt}
                  sizes="(min-width: 1024px) 640px, 100vw"
                  className="h-auto w-full rounded-xl"
                />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-16 text-xs text-ink/45">Screens show sample data.</p>
      </div>
    </section>
  );
}
