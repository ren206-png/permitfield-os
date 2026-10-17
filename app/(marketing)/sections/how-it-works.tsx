// COPY_DECK.md §3. Each step maps to a SHIPPED capability in
// MARKETING_CAPABILITY_LEDGER.md: step 1 -> §1, step 2 -> §2, step 3 -> §5
// (worded to match what the product actually does -- the contractor files,
// the product tracks status, never "we submit it for you").
const STEPS = [
  {
    title: 'Start an application.',
    body: 'Add project and jurisdiction details to create a new permit application.',
  },
  {
    title: 'Upload your documents.',
    body:
      "PermitField extracts key applicant, contractor, and scope details " +
      "automatically, so you're not retyping what's already in your paperwork.",
  },
  {
    title: 'Track it through to filing.',
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
        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-600 to-amber-600 text-sm font-semibold text-white shadow-lg shadow-orange-950/50">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
