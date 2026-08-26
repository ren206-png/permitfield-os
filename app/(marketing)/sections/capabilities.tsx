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
  },
  {
    title: 'AI-assisted document extraction',
    body: 'Key fields pulled from your uploads for review, not blind auto-fill.',
    ledgerRef: '§2',
  },
  {
    title: 'Form auto-fill where supported',
    body:
      'For the Toronto Electrical Service Upgrade form today, with more ' +
      'forms being added over time.',
    ledgerRef: '§3',
  },
  {
    title: 'Organization-level data isolation',
    body:
      'Your applications are scoped to your organization, enforced at the ' +
      'database layer.',
    ledgerRef: '§10',
  },
] as const;

export function Capabilities() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-semibold text-zinc-900">
        What PermitField OS does today
      </h2>
      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        {CAPABILITIES.map((capability) => (
          <div
            key={capability.title}
            className="rounded-lg border border-zinc-200 p-6"
          >
            <h3 className="text-base font-semibold text-zinc-900">
              {capability.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-600">{capability.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
