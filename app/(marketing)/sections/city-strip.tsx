import { getPublicJurisdictionsForIndex } from '@/lib/jurisdictions/public-directory';

// COPY_DECK.md §2a. The cities come from the same coverage registry as
// sections/coverage.tsx (lib/jurisdictions/public-directory.ts), so this
// strip can never name a place the coverage section doesn't list. It names
// places only -- each one's tier is disclosed in #coverage, which the
// strip links to.
export async function CityStrip() {
  const jurisdictions = await getPublicJurisdictionsForIndex();
  if (jurisdictions.length === 0) return null;

  return (
    <section aria-label="Where PermitField OS works today" className="border-y border-line bg-white/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 sm:px-6 md:flex-row md:items-center md:gap-6">
        <a href="#coverage" className="shrink-0 text-xs font-medium uppercase tracking-[0.2em] text-ink/50 transition hover:text-ink">
          Working today in
        </a>
        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-lg text-ink/80">
          {jurisdictions.map((jurisdiction, index) => (
            <li key={jurisdiction.id} className="flex items-center gap-2.5">
              {index > 0 && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-clay/50" />}
              {jurisdiction.municipality}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
