// COPY_DECK.md §3. Each step maps to a SHIPPED capability in
// MARKETING_CAPABILITY_LEDGER.md: step 1 -> §1, step 2 -> §2, step 3 -> §5
// (worded to match what the product actually does -- the contractor files,
// the product tracks status, never "we submit it for you").
const STEPS = [
  {
    title: 'Start an application.',
    body: 'Add project and jurisdiction details to create a new permit application.',
    accent: 'from-indigo-600 to-indigo-500 shadow-indigo-200 dark:shadow-none',
  },
  {
    title: 'Upload your documents.',
    body:
      "PermitField extracts key applicant, contractor, and scope details " +
      "automatically, so you're not retyping what's already in your paperwork.",
    accent: 'from-sky-600 to-sky-500 shadow-sky-200 dark:shadow-none',
  },
  {
    title: 'Track it through to filing.',
    body:
      'Watch your application move from draft to documents-ready, and mark ' +
      "it submitted once you've filed with the authority.",
    accent: 'from-violet-600 to-violet-500 shadow-violet-200 dark:shadow-none',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">How it works</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white shadow-md ${step.accent}`}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-white">
                {step.title}
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
