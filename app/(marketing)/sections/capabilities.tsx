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
    title: "The city's own form, filled in",
    body:
      "Commercial tenant improvement forms in every city we cover except " +
      'Calgary, plus Toronto electrical service upgrades. Calgary files ' +
      'online only, so you get every answer ready to paste.',
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
    <section id="features" className="relative border-t border-white/5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.15),transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <p className="text-center text-sm font-medium text-orange-300">Features</p>
        <h2 className="mt-2 text-center text-3xl font-semibold tracking-tight text-white">
          What PermitField OS does today
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <div
              key={capability.title}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition hover:-translate-y-0.5 hover:border-orange-400/40 hover:bg-white/[0.05]"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 text-sm font-semibold text-white shadow-lg shadow-orange-950/50">
                {capability.title.charAt(0)}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">{capability.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{capability.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
