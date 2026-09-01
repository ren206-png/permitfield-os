import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isJurisdictionPagesEnabled } from '@/lib/flags';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';
import { SITE_URL } from '@/lib/seo';
import { CoverageBadge } from '@/components/coverage-badge';
import {
  getPublicJurisdictionsForIndex,
  provinceSlug,
  municipalitySlug,
} from '@/lib/jurisdictions/public-directory';

// Pinned explicitly rather than left to incidental detection: with the
// default 'anon-rls' data strategy, lib/supabase/server.ts's cookies() call
// makes Next.js infer dynamic rendering on its own, but with the
// 'service-role' strategy (lib/jurisdictions/public-directory.ts's other,
// dormant-by-default option) there is no such signal, and Next attempted to
// statically prerender this page at build time instead -- confirmed by a
// real build failure (a build-time fetch against a fake host) when testing
// that strategy locally. Reference data here can change independently of
// any deploy (new jurisdictions/permit_types rows), so this page should
// never be frozen at build time under either strategy.
export const dynamic = 'force-dynamic';

const TITLE = `Jurisdiction coverage | ${PRODUCT_NAME}`;
const DESCRIPTION =
  `Canadian jurisdictions where ${PRODUCT_NAME} tracks permit requirements today, by coverage tier.`;

export async function generateMetadata(): Promise<Metadata> {
  if (!isJurisdictionPagesEnabled()) {
    return {};
  }

  const canonical = `${SITE_URL}/coverage`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical },
    openGraph: { title: TITLE, description: DESCRIPTION, url: canonical, type: 'website' },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  };
}

export default async function CoverageIndexPage() {
  if (!isJurisdictionPagesEnabled()) {
    notFound();
  }

  const jurisdictions = await getPublicJurisdictionsForIndex();

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-16">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
        Jurisdiction coverage
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        &quot;Verified&quot; means we&apos;ve reviewed the applicable code and
        requirements directly; &quot;Assisted&quot; jurisdictions are earlier in that
        process. Only jurisdictions with permit types we&apos;ve actually documented
        get a page below -- see each jurisdiction&apos;s own coverage badge for what&apos;s
        enabled today.
      </p>

      <ul className="mt-8 space-y-3">
        {jurisdictions.map((jurisdiction) => {
          const place = `${jurisdiction.municipality}, ${jurisdiction.provinceCode.toUpperCase()}`;
          const row = (
            <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-sm font-medium text-zinc-900 dark:text-white">
                {place}
              </span>
              <CoverageBadge coverageLevel={jurisdiction.coverageLevel} />
            </div>
          );

          return (
            <li key={jurisdiction.id}>
              {jurisdiction.hasDetailPage ? (
                <Link
                  href={`/permits/ca/${provinceSlug(jurisdiction.provinceCode)}/${municipalitySlug(jurisdiction.municipality)}`}
                  className="block transition hover:opacity-80"
                >
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">{LEGAL_DISCLAIMER}</p>

      <p className="mt-6 text-sm">
        <Link
          href="/"
          className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
        >
          Back to {PRODUCT_NAME}
        </Link>
      </p>
    </div>
  );
}
