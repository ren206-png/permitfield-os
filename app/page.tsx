import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMarketingV2Enabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';
import { PRODUCT_NAME } from '@/lib/brand';
import { MarketingHomepage } from './(marketing)/marketing-homepage';

const HOMEPAGE_TITLE = `${PRODUCT_NAME} — Permit application tracking for contractors`;
const HOMEPAGE_DESCRIPTION =
  'Organize permit applications, documents, and filing status in one place, ' +
  'with AI-assisted document extraction. Currently covering Toronto and Calgary.';

// Marketing Homepage v2, Phase 3 (COPY_DECK.md SS8). Co-located with the
// page rather than in app/layout.tsx so it only ever overrides the
// site-wide default (PRODUCT_NAME / generic description) for this one
// route, and only when the flag is on -- with the flag off this returns an
// empty object, which Next.js merges with (i.e. does not change)
// app/layout.tsx's existing metadata, keeping this file's off-path
// byte-identical the same way every other flag-gated change in this repo
// is. No `images` field on openGraph/twitter -- no real product screenshot
// or logo asset exists yet (MARKETING_PHASE_0_FINDINGS.md SS3, SS7), and
// pointing OG tags at a placeholder would be exactly the kind of fabricated
// product visual the master prompt's anti-fabrication rule forbids.
export async function generateMetadata(): Promise<Metadata> {
  if (!isMarketingV2Enabled()) {
    return {};
  }

  return {
    title: HOMEPAGE_TITLE,
    description: HOMEPAGE_DESCRIPTION,
    alternates: {
      canonical: SITE_URL,
    },
    openGraph: {
      title: HOMEPAGE_TITLE,
      description: HOMEPAGE_DESCRIPTION,
      url: SITE_URL,
      siteName: PRODUCT_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: HOMEPAGE_TITLE,
      description: HOMEPAGE_DESCRIPTION,
    },
  };
}

// Marketing Homepage v2 (IMPLEMENTATION_PLAN.md SS3): historically proxy.ts
// redirected every unauthenticated request away from every non-/login route
// (including this one) before this component ever rendered, so reaching
// here always meant a session existed and this file was just a redirect,
// not a page. proxy.ts now lets an unauthenticated request through to '/'
// specifically when isMarketingV2Enabled() is on (see that file's own
// comment), so this component does its own auth.getUser() check rather than
// assuming one was already done upstream -- same "proxy checks are never a
// substitute for a Server Component's own check" discipline
// lib/auth/org-context.ts already follows. There's still no dashboard-at-root
// concept for signed-in users -- /applications remains the one home screen.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/applications');
  }

  if (isMarketingV2Enabled()) {
    return <MarketingHomepage />;
  }

  // Defensive fallback, not normally reachable: with the flag off, proxy.ts
  // already redirects this exact case to /login before this component ever
  // renders (see proxy.ts's isPublicMarketingRoute). Kept so this component
  // is correct standalone, matching this file's pre-existing pattern of not
  // assuming upstream behavior it can independently verify.
  redirect('/login');
}
