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
export async function Coverage() {
  const jurisdictions = await getPublicJurisdictionsForIndex();
  const jurisdictionPagesEnabled = isJurisdictionPagesEnabled();

  return (
    <section
      id="coverage"
      className="border-t border-zinc-200 bg-gradient-to-b from-zinc-50 to-white dark:border-zinc-800 dark:from-zinc-900/40 dark:to-zinc-950"
    >
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">
          What&apos;s covered today
        </h2>
        {/*
          CoverageBadge itself (imported above) is intentionally left
          untouched -- see its own header comment. Its pastel
          bg-*-100/text-*-700 chips carry their own background, so they
          stay legible as light pills on a dark card without any dark:
          variant of their own.
        */}
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {jurisdictions.map((jurisdiction) => {
            const place = `${jurisdiction.municipality}, ${jurisdiction.provinceCode.toUpperCase()}`;
            const rowClassName =
              'flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:shadow-none';
            const row = (
              <>
                <span className="text-sm font-medium text-zinc-900 dark:text-white">
                  {place}
                </span>
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
                    className={rowClassName}
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
        <p className="mt-6 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
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
