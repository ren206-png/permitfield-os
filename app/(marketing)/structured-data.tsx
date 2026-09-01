import { PRODUCT_NAME } from '@/lib/brand';
import { SITE_URL, HOMEPAGE_DESCRIPTION } from '@/lib/seo';

// Marketing Homepage v2, Phase 3. Only rendered inside MarketingHomepage,
// so it inherits that component's own flag gate (app/page.tsx) rather than
// re-checking isMarketingV2Enabled() itself -- there's no route that could
// render this in isolation.
//
// Deliberately minimal: Organization + WebSite + SoftwareApplication only,
// every field sourced from data that's actually true (lib/brand.ts,
// lib/seo.ts, app/page.tsx's HOMEPAGE_DESCRIPTION). No AggregateRating,
// review, or offers/price -- MARKETING_CAPABILITY_LEDGER.md's
// zero-tolerance fabrication list forbids ratings/review-count claims and
// there is no billing/pricing system to describe an `offers` block from
// (ledger SS15, lib/entitlements/index.ts:4 -- "THIS IS NOT A REAL
// BILLING/SUBSCRIPTION SYSTEM"). No `sameAs` social links either -- none
// exist to cite (see COPY_DECK.md SS7).
//
// LP workstream, Phase 2 (LP_PHASE_0_FINDINGS.md SS0.2, §5):
// SoftwareApplication added per the master prompt's explicit direction.
// `applicationCategory: BusinessApplication` matches schema.org's own
// enumerated list (not a free-text guess); `operatingSystem: 'Web'` is
// factually accurate (no native app exists to overclaim); `description`
// reuses HOMEPAGE_DESCRIPTION verbatim so this node can't drift from the
// meta description it's describing.
export function StructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: PRODUCT_NAME,
        url: SITE_URL,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: PRODUCT_NAME,
        url: SITE_URL,
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#software`,
        name: PRODUCT_NAME,
        url: SITE_URL,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: HOMEPAGE_DESCRIPTION,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
