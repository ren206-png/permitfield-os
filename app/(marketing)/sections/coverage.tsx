import Link from 'next/link';
import { CoverageBadge } from '@/components/coverage-badge';
import { isJurisdictionPagesEnabled } from '@/lib/flags';
import {
  getPublicJurisdictionsForIndex,
  provinceSlug,
  municipalitySlug,
} from '@/lib/jurisdictions/public-directory';

// COPY_DECK.md §5. Deliberately reuses components/coverage-badge.tsx's own
// component and tier language (verified / assisted -- AI audit off / listed
// -- not yet covered) rather than inventing softer marketing synonyms --
// that component's own header comment calls miscommunicating these tiers
// "the single most likely way this product injures a customer." Reusing the
// component directly (not just copying its labels) means this section can't
// drift from the in-product badge even if that component's wording changes
// later.
//
// Gap fix (LP workstream follow-up, jurisdiction-expansion scoping session):
// this used to be a hardcoded JURISDICTIONS array that happened to match
// supabase/seed.sql's 4 rows but had no actual link to the database -- any
// jurisdiction added later would silently not appear here without a second,
// easy-to-forget manual edit, the same "list would drift from what pages
// actually render" problem app/coverage/page.tsx and app/sitemap.ts were
// already built to avoid (LP_PHASE_0_FINDINGS.md's thin-content discipline).
// Now reads the same lib/jurisdictions/public-directory.ts module and the
// same public_jurisdictions/public_permit_types views those pages use, so
// this section, /coverage, and the sitemap can never disagree about what's
// covered. Async Server Component: Next.js resolves this independently of
// whether its parent (MarketingHomepage) is itself async -- no other file
// needs to change for this to render correctly.
const PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  ON: 'Ontario',
};

export async function Coverage() {
  const jurisdictions = await getPublicJurisdictionsForIndex();
  const jurisdictionPagesEnabled = isJurisdictionPagesEnabled();

  // Grouped by province, in the registry's own order within each group.
  const byProvince = new Map<string, typeof jurisdictions>();
  for (const jurisdiction of jurisdictions) {
    const code = jurisdiction.provinceCode.toUpperCase();
    byProvince.set(code, [...(byProvince.get(code) ?? []), jurisdiction]);
  }
  const provinces = [...byProvince.keys()].sort((a, b) =>
    (PROVINCE_NAMES[a] ?? a).localeCompare(PROVINCE_NAMES[b] ?? b)
  );

  return (
    <section id="coverage" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-clay">Coverage</p>
          <h2 className="mt-4 font-display text-5xl tracking-tight sm:text-6xl">What&apos;s covered today</h2>
        </div>
        {/*
          CoverageBadge itself (imported above) is intentionally left
          untouched -- see its own header comment.
        */}
        <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
          {provinces.map((code) => (
            <div key={code}>
              <h3 className="border-b border-ink pb-3 font-display text-2xl tracking-tight">
                {PROVINCE_NAMES[code] ?? code}
              </h3>
              <ul>
                {(byProvince.get(code) ?? []).map((jurisdiction) => {
                  const rowClassName =
                    'flex items-center justify-between gap-3 border-b border-line py-3.5 text-[15px] transition';
                  const row = (
                    <>
                      <span>{jurisdiction.municipality}</span>
                      <CoverageBadge coverageLevel={jurisdiction.coverageLevel} />
                    </>
                  );

                  return (
                    <li key={jurisdiction.id}>
                      {/* Same thin-content discipline as app/coverage/page.tsx:
                          only link to a detail page that will actually render
                          (real permit_types content) and only when that route is
                          itself enabled -- this section's own flag
                          (isMarketingV2Enabled) is unrelated to
                          isJurisdictionPagesEnabled, so both must be true. */}
                      {jurisdictionPagesEnabled && jurisdiction.hasDetailPage ? (
                        <Link
                          href={`/permits/ca/${provinceSlug(jurisdiction.provinceCode)}/${municipalitySlug(jurisdiction.municipality)}`}
                          className={`${rowClassName} hover:text-clay`}
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className={rowClassName}>{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 max-w-2xl text-sm leading-relaxed text-ink/55">
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
