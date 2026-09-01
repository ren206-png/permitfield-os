import type { MetadataRoute } from 'next';
import { isMarketingV2Enabled, isJurisdictionPagesEnabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';

// Marketing Homepage v2, Phase 3. Mirrors app/sitemap.ts's flag gate.
//
// Both flags off: '/' redirects to /login for every visitor (see proxy.ts)
// and /coverage + /permits/ca/... 404 outright -- there is nothing on this
// site for a crawler to index, so disallow everything and omit the sitemap
// reference entirely.
//
// Either flag on: allow '/', the one route Marketing Homepage v2 makes
// actually public, and -- independently -- /coverage and /permits/ca/...
// once isJurisdictionPagesEnabled() is on (LP workstream, Phase 3). These
// two flags are unrelated and can be on independently, so the condition
// below is "either," not "the marketing flag." Every other top-level path
// is part of the authenticated product (/login, /onboarding, /applications,
// /projects, /contractors) or the internal API surface (/api) and must not
// be crawled or indexed -- robots rules are a politeness signal here, not
// the security boundary; proxy.ts's auth redirect (or each jurisdiction
// page's own notFound() when its flag is off) is what actually keeps those
// routes unreachable, same as it does today.
export default function robots(): MetadataRoute.Robots {
  if (!isMarketingV2Enabled() && !isJurisdictionPagesEnabled()) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/login',
        '/onboarding',
        '/applications',
        '/projects',
        '/contractors',
        '/api/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
