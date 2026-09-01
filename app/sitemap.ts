import type { MetadataRoute } from 'next';
import { isMarketingV2Enabled, isJurisdictionPagesEnabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';
import {
  getPublicJurisdictionsForIndex,
  provinceSlug,
  municipalitySlug,
} from '@/lib/jurisdictions/public-directory';

// Marketing Homepage v2, Phase 3. Lists '/' -- the single route that flag
// makes actually public (see proxy.ts, app/page.tsx). Every other route in
// this product requires an authenticated session and must never be
// advertised to a crawler, except the jurisdiction SEO pages added below,
// which self-gate and allowlist the same way (see each flag's own comments).
//
// Now async (LP workstream, Phase 3): jurisdiction URLs are read from the
// same lib/jurisdictions/public-directory.ts module the pages themselves
// use, so this file can never list a URL neither page would actually
// render -- same "only linkable jurisdictions get a link" thin-content
// discipline as app/coverage/page.tsx.
//
// Forced dynamic for the same reason as that page's own `dynamic` export:
// confirmed via a real build failure (a build-time fetch against a fake
// host) that under lib/jurisdictions/public-directory.ts's 'service-role'
// data strategy, Next.js has no dynamic-API signal to infer this should be
// server-rendered on demand and instead tries to statically freeze it at
// build time -- wrong for a file whose jurisdiction list can change
// independently of any deploy.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  if (isMarketingV2Enabled()) {
    entries.push({
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    });
  }

  if (isJurisdictionPagesEnabled()) {
    entries.push({
      url: `${SITE_URL}/coverage`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    });

    const jurisdictions = await getPublicJurisdictionsForIndex();
    for (const jurisdiction of jurisdictions) {
      // Thin-content rule (master prompt §6): only jurisdictions with a real
      // detail page (permit_types content) get a sitemap entry -- same test
      // app/coverage/page.tsx uses to decide whether to render a link.
      if (!jurisdiction.hasDetailPage) {
        continue;
      }

      entries.push({
        url: `${SITE_URL}/permits/ca/${provinceSlug(jurisdiction.provinceCode)}/${municipalitySlug(jurisdiction.municipality)}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  return entries;
}
