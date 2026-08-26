import type { MetadataRoute } from 'next';
import { isMarketingV2Enabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';

// Marketing Homepage v2, Phase 3. Mirrors app/sitemap.ts's flag gate.
//
// Flag off: '/' redirects to /login for every visitor (see proxy.ts) --
// there is nothing on this site for a crawler to index, so disallow
// everything and omit the sitemap reference entirely.
//
// Flag on: allow only '/', the one route this phase makes actually public.
// Every other top-level path is part of the authenticated product
// (/login, /onboarding, /applications, /projects, /contractors) or the
// internal API surface (/api) and must not be crawled or indexed -- robots
// rules are a politeness signal here, not the security boundary; proxy.ts's
// auth redirect is what actually keeps those routes unreachable without a
// session, same as it does today.
export default function robots(): MetadataRoute.Robots {
  if (!isMarketingV2Enabled()) {
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
