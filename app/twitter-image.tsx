import { OG_IMAGE_ALT, OG_IMAGE_SIZE, renderOgCard } from '@/lib/marketing/og-card';

// LP workstream, Phase 2. Mirrors app/opengraph-image.tsx (same shared
// renderer) so Twitter's summary_large_image card and Open Graph's card are
// byte-identical rather than two hand-maintained images that can drift.
export const alt = OG_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgCard();
}
