import type { MetadataRoute } from 'next';
import { isMarketingV2Enabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';

// Marketing Homepage v2, Phase 3. Lists only '/' -- the single route this
// flag makes actually public (see proxy.ts, app/page.tsx). Every other
// route in this product requires an authenticated session and must never be
// advertised to a crawler. Returns an empty sitemap when the flag is off so
// this file never lists a URL that redirects to /login for an anonymous
// visitor -- same off-path-is-inert discipline every other flag-gated file
// in this phase follows.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isMarketingV2Enabled()) {
    return [];
  }

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
