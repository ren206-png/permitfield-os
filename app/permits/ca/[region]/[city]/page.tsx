import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isJurisdictionPagesEnabled } from '@/lib/flags';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';
import { SITE_URL } from '@/lib/seo';
import { CoverageBadge } from '@/components/coverage-badge';
import {
  findJurisdictionBySlug,
  getPermitTypesForJurisdiction,
  type PublicJurisdiction,
  type PublicPermitType,
} from '@/lib/jurisdictions/public-directory';

// See app/coverage/page.tsx's identical comment: forced explicitly so this
// page can't get frozen at build time under either data-access strategy,
// not relying on incidental dynamic-API detection.
export const dynamic = 'force-dynamic';

type Params = { region: string; city: string };

type PageData = {
  jurisdiction: PublicJurisdiction;
  permitTypes: PublicPermitType[];
};

// Shared by generateMetadata and the page component so a request that
// resolves to no page (flag off, unknown slug, or a jurisdiction with no
// real content yet) is decided exactly once, the same way, in both places --
// see the thin-content note below.
async function loadPageData(params: Params): Promise<PageData | null> {
  if (!isJurisdictionPagesEnabled()) {
    return null;
  }

  const jurisdiction = await findJurisdictionBySlug(params.region, params.city);
  if (!jurisdiction) {
    return null;
  }

  const permitTypes = await getPermitTypesForJurisdiction(jurisdiction.id);
  // Thin-content rule (master prompt §6: "real substance or fewer pages,
  // never thinner ones"). Confirmed via supabase/seed.sql that Ottawa
  // (assisted) has zero permit_types rows today -- this is what keeps that
  // case a 404 instead of a page with a badge and nothing else on it.
  if (permitTypes.length === 0) {
    return null;
  }

  return { jurisdiction, permitTypes };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const data = await loadPageData(resolvedParams);
  if (!data) {
    return {};
  }

  const { jurisdiction, permitTypes } = data;
  const place = `${jurisdiction.municipality}, ${jurisdiction.provinceCode.toUpperCase()}`;
  const title = `Permit application software in ${place} | ${PRODUCT_NAME}`;
  const description =
    `${PRODUCT_NAME} coverage for ${place}: ${permitTypes.length} permit ` +
    `type${permitTypes.length === 1 ? '' : 's'} tracked, ${jurisdiction.coverageLevel} tier. ` +
    'Not legal or code advice.';
  const canonical = `${SITE_URL}/permits/ca/${resolvedParams.region}/${resolvedParams.city}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function JurisdictionPage({ params }: { params: Promise<Params> }) {
  const resolvedParams = await params;
  const data = await loadPageData(resolvedParams);
  if (!data) {
    notFound();
  }

  const { jurisdiction, permitTypes } = data;
  const place = `${jurisdiction.municipality}, ${jurisdiction.provinceCode.toUpperCase()}`;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-16">
      <nav className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/coverage" className="hover:underline">
          Coverage
        </Link>
        {' / '}
        {place}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">{place}</h1>
        <CoverageBadge coverageLevel={jurisdiction.coverageLevel} />
      </div>

      {jurisdiction.portalUrl && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Filing portal:{' '}
          <a
            href={jurisdiction.portalUrl}
            className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
            rel="noopener noreferrer"
          >
            {jurisdiction.portalUrl}
          </a>
        </p>
      )}

      <h2 className="mt-10 text-lg font-medium text-zinc-900 dark:text-white">
        Permit types tracked
      </h2>
      <ul className="mt-4 space-y-2">
        {permitTypes.map((permitType) => (
          <li
            key={permitType.id}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
          >
            {permitType.title}
          </li>
        ))}
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
