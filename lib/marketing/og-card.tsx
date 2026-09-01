import { ImageResponse } from 'next/og';
import { PRODUCT_NAME } from '@/lib/brand';

// LP workstream, Phase 2 (LP_PHASE_0_FINDINGS.md SS0.4, SS0.6). Shared by
// app/opengraph-image.tsx and app/twitter-image.tsx so both surfaces render
// byte-identical output from one source instead of drifting apart.
//
// Deliberately a generated branded card, not a product screenshot -- no
// real screenshot exists yet (MARKETING_PHASE_0_FINDINGS.md SS7), and the
// master prompt's anti-fabrication rule forbids a product visual showing
// fake data. The only text on the card is the product name and the exact
// description string already live, ungated, in app/layout.tsx:18 -- no new
// claim is introduced here that isn't already true and already shipping
// site-wide.
//
// Not gated behind isMarketingV2Enabled(): unlike app/page.tsx's
// generateMetadata(), Next.js exposes opengraph-image/twitter-image as
// their own routes regardless of that flag, and there is no page for a
// flag-off card to attach a false claim to -- the two lines of text on it
// are unconditionally true whether or not the flag is on.
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const OG_IMAGE_ALT = `${PRODUCT_NAME} — AI-assisted permitting for Canadian commercial and trade contractors.`;

const CARD_DESCRIPTION =
  'AI-assisted permitting for Canadian commercial and trade contractors.';

export function renderOgCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          backgroundImage:
            'linear-gradient(135deg, #eef2ff 0%, #e0f2fe 55%, #ffffff 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: '#18181b',
            letterSpacing: '-0.02em',
          }}
        >
          {PRODUCT_NAME}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 32,
            color: '#3f3f46',
            maxWidth: 820,
          }}
        >
          {CARD_DESCRIPTION}
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE }
  );
}
