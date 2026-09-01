import { OG_IMAGE_ALT, OG_IMAGE_SIZE, renderOgCard } from '@/lib/marketing/og-card';

// LP workstream, Phase 2. Colocated at the project root so it scopes to
// the `/` segment only (see Next.js opengraph-image file-convention docs:
// each route segment resolves its own image file) -- it does not apply to
// /login, /applications, or any other segment, matching this phase's scope
// (the marketing homepage only).
export const alt = OG_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderOgCard();
}
