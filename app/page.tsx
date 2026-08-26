import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMarketingV2Enabled } from '@/lib/flags';
import { MarketingHomepage } from './(marketing)/marketing-homepage';

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
