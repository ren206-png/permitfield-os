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
    <section id="how-it-works" className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <p className="text-center text-sm font-medium text-orange-300">Three steps</p>
        <h2 className="mt-2 text-center text-3xl font-semibold tracking-tight text-white">How it works</h2>
        <ol className="mt-14 flex flex-col gap-20">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-600 to-amber-600 text-sm font-semibold text-white shadow-lg shadow-orange-950/50">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight text-white">{step.title}</h3>
                <p className="mt-3 leading-relaxed text-slate-400">{step.body}</p>
              </div>
              <div className="rounded-2xl border border-orange-400/20 bg-gradient-to-b from-orange-500/10 to-transparent p-2 shadow-2xl shadow-orange-950/40 sm:p-3">
                <Image
                  src={step.shot.src}
                  width={step.shot.width}
                  height={step.shot.height}
                  alt={step.shot.alt}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="h-auto w-full rounded-xl"
                />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-12 text-center text-xs text-slate-500">Screens show sample data.</p>
      </div>
    </section>
  );
}
