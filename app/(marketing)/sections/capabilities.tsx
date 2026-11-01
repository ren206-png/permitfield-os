// COPY_DECK.md §4. Each card cites its MARKETING_CAPABILITY_LEDGER.md row
// so an editor can't drift the claim away from its evidence without also
// touching this comment. Notifications, deadline alerts, team invites,
// analytics/reporting, e-signature, and third-party API/integrations are
// deliberately absent from this list -- none has an approved-claim row in
// the ledger (all are NOT BUILT or DB-only-with-no-UI).
// Icons are simple line drawings (24px viewBox, stroked), not product art.
const CAPABILITIES = [
  {
    title: 'Centralized intake & tracking',
    body: "Every application's documents, status, and history in one record.",
    ledgerRef: '§1, §18',
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    title: 'AI-assisted document extraction',
    body: 'Key fields pulled from your uploads for review, not blind auto-fill.',
    ledgerRef: '§2',
    icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4',
  },
  {
    title: "The city's own form, filled in",
    body:
      "Commercial tenant improvement forms in every city we cover except " +
      'Calgary, plus Toronto electrical service upgrades. Calgary files ' +
      'online only, so you get every answer ready to paste.',
    ledgerRef: '§3',
    icon: 'M5 4h14v16H5zM9 9l2 2 4-4M9 15h6',
  },
  {
    title: 'Organization-level data isolation',
    body:
      'Your applications are scoped to your organization, enforced at the ' +
      'database layer.',
    ledgerRef: '§10',
    icon: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
  },
] as const;

export function Capabilities() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-clay">Features</p>
            <h2 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
              What PermitField OS does today
            </h2>
          </div>
          <div className="grid border-t border-line sm:grid-cols-2">
            {CAPABILITIES.map((capability, index) => (
              <div
                key={capability.title}
                className={`border-b border-line py-8 sm:px-8 ${index % 2 === 0 ? 'sm:border-r sm:pl-0' : 'sm:pr-0'}`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-6 w-6 fill-none stroke-clay"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={capability.icon} />
                </svg>
                <h3 className="mt-5 font-display text-2xl tracking-tight">{capability.title}</h3>
                <p className="mt-2 leading-relaxed text-ink/65">{capability.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
