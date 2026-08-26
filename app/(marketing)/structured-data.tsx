import { PRODUCT_NAME } from '@/lib/brand';
import { SITE_URL } from '@/lib/seo';

// Marketing Homepage v2, Phase 3. Only rendered inside MarketingHomepage,
// so it inherits that component's own flag gate (app/page.tsx) rather than
// re-checking isMarketingV2Enabled() itself -- there's no route that could
// render this in isolation.
//
// Deliberately minimal: Organization + WebSite only, both fields sourced
// from data that's actually true (lib/brand.ts, lib/seo.ts). No
// AggregateRating, review, or offers/price -- MARKETING_CAPABILITY_LEDGER.md's
// zero-tolerance fabrication list forbids ratings/review-count claims and
// there is no billing/pricing system to describe an `offers` block from
// (ledger SS15). No `sameAs` social links either -- none exist to cite (see
// COPY_DECK.md SS7).
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
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
