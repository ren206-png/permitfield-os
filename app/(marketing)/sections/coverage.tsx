import { CoverageBadge } from '@/components/coverage-badge';

// COPY_DECK.md §5. Deliberately reuses components/coverage-badge.tsx's own
// component and tier language (verified / assisted -- AI audit off / listed
// -- not yet covered) rather than inventing softer marketing synonyms --
// that component's own header comment calls miscommunicating these tiers
// "the single most likely way this product injures a customer." Reusing the
// component directly (not just copying its labels) means this section can't
// drift from the in-product badge even if that component's wording changes
// later.
const JURISDICTIONS = [
  { name: 'Toronto, ON', level: 'verified' },
  { name: 'Calgary, AB', level: 'verified' },
  { name: 'Ottawa, ON', level: 'assisted' },
  { name: 'Hamilton, ON', level: 'listed' },
] as const;

export function Coverage() {
  return (
    <section id="coverage" className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold text-zinc-900">
          What&apos;s covered today
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {JURISDICTIONS.map((jurisdiction) => (
            <li
              key={jurisdiction.name}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-zinc-900">
                {jurisdiction.name}
              </span>
              <CoverageBadge coverageLevel={jurisdiction.level} />
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-2xl text-sm text-zinc-600">
          PermitField OS is expanding jurisdiction by jurisdiction.
          &quot;Verified&quot; means we&apos;ve reviewed the applicable code
          and requirements directly; &quot;Assisted&quot; and
          &quot;Listed&quot; jurisdictions are earlier in that process — see
          in-product coverage badges for what&apos;s enabled at each stage.
        </p>
      </div>
    </section>
  );
}
