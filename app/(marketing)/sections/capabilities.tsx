// COPY_DECK.md §4. Each card cites its MARKETING_CAPABILITY_LEDGER.md row
// so an editor can't drift the claim away from its evidence without also
// touching this comment. Notifications, deadline alerts, team invites,
// analytics/reporting, e-signature, and third-party API/integrations are
// deliberately absent from this list -- none has an approved-claim row in
// the ledger (all are NOT BUILT or DB-only-with-no-UI).
const CAPABILITIES = [
  {
    title: 'Centralized intake & tracking',
    body: "Every application's documents, status, and history in one record.",
    ledgerRef: '§1, §18',
    accent: 'from-indigo-600 to-indigo-500',
  },
  {
    title: 'AI-assisted document extraction',
    body: 'Key fields pulled from your uploads for review, not blind auto-fill.',
    ledgerRef: '§2',
    accent: 'from-sky-600 to-sky-500',
  },
  {
    title: 'Form auto-fill where supported',
    body:
      'For the Toronto Electrical Service Upgrade form today, with more ' +
      'forms being added over time.',
    ledgerRef: '§3',
    accent: 'from-violet-600 to-violet-500',
  },
  {
    title: 'Organization-level data isolation',
    body:
      'Your applications are scoped to your organization, enforced at the ' +
      'database layer.',
    ledgerRef: '§10',
    accent: 'from-teal-600 to-teal-500',
  },
] as const;

export function Capabilities() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">
        What PermitField OS does today
      </h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {CAPABILITIES.map((capability) => (
          <div
            key={capability.title}
            className="group rounded-xl border border-zinc-200 p-6 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-100 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:shadow-none"
          >
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-semibold text-white shadow-sm dark:shadow-none ${capability.accent}`}
            >
              {capability.title.charAt(0)}
            </span>
            <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-white">
              {capability.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{capability.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
