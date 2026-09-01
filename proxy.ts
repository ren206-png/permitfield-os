import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isMarketingV2Enabled, isJurisdictionPagesEnabled } from '@/lib/flags';

// Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` (same
// runtime behavior, new file/export name -- see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
// required reading per this repo's AGENTS.md before touching anything
// routing-related). This is the standard @supabase/ssr session-refresh
// pattern: every request re-validates the auth token and re-issues cookies
// *before* a Server Component renders, so a Server Component's own
// `supabase.auth.getUser()` call (lib/auth/org-context.ts) never sees a
// silently-expired session. lib/supabase/server.ts's `setAll` is a no-op
// when called from a Server Component render for exactly this reason -- this
// file is where the actual cookie refresh happens.
//
// This does not replace any RLS check or the org-membership redirect in
// lib/auth/org-context.ts -- it only keeps the session cookie valid. Route
// Handlers and Server Components still independently verify
// `auth.getUser()` before touching data, per the Next docs' own warning that
// proxy/middleware auth checks are not a substitute for per-request checks.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Refreshes the session token if needed. The return value is
  // intentionally unused beyond forcing the refresh -- redirect decisions
  // are made below from the same call's result, not cached.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === '/login';
  // Marketing Homepage v2 (IMPLEMENTATION_PLAN.md SS2): the one path this
  // proxy lets an unauthenticated request reach besides /login itself, and
  // only while the flag is on. When isMarketingV2Enabled() is false this
  // resolves to `false` for every request, so the branch below is byte-for-
  // byte identical to its pre-flag behavior -- app/page.tsx still does its
  // own auth.getUser() check before deciding what to render (per this
  // file's own header comment: proxy checks are never a substitute for a
  // Server Component's own check), so this is not a weakening of any
  // existing authenticated route, only an allowlist entry for '/' itself.
  const isPublicMarketingRoute = isMarketingV2Enabled() && pathname === '/';
  // Marketing Homepage v2, Phase 3: app/robots.ts and app/sitemap.ts are
  // always reachable unauthenticated, unconditionally (not flag-gated here)
  // -- unlike '/' above, these two files already self-gate their own
  // content on isMarketingV2Enabled() (disallow-all / empty sitemap when
  // off, per each file's own header comment), so redirecting an
  // unauthenticated crawler away from them to /login would be strictly
  // worse in both flag states: with the flag off it hides a harmless
  // "disallow all," and with the flag on it would make the SEO artifacts
  // this phase adds uncrawlable, defeating their purpose. No other route is
  // affected -- this is scoped to exactly these two well-known,
  // content-self-gated filenames.
  const isPublicSeoRoute = pathname === '/robots.txt' || pathname === '/sitemap.xml';
  // LP workstream, Phase 3 (jurisdiction SEO pages, PERMITFIELD_FF_JURISDICTION_PAGES).
  // Same allowlist pattern as isPublicMarketingRoute above: only reachable
  // unauthenticated while the flag is on, and app/coverage/page.tsx +
  // app/permits/ca/[region]/[city]/page.tsx each independently 404 (not just
  // redirect) when the flag is off, per this file's own "proxy checks are
  // never a substitute for a Server Component's own check" discipline. Only
  // these two path shapes -- no other route under /permits or elsewhere is
  // affected.
  const isPublicJurisdictionRoute =
    isJurisdictionPagesEnabled() &&
    (pathname === '/coverage' || pathname.startsWith('/permits/ca/'));

  if (
    !user &&
    !isAuthRoute &&
    !isPublicMarketingRoute &&
    !isPublicSeoRoute &&
    !isPublicJurisdictionRoute
  ) {
    const redirectUrl = new URL('/login', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = new URL('/applications', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Every path except: API routes, the Inngest endpoint, Next internals,
    // and static assets. /api routes each do their own auth.getUser() check
    // (see app/api/documents/route.ts, confirm-review/route.ts) and must
    // return JSON errors, not an HTML redirect, on missing auth.
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
