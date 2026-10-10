import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isMarketingV2Enabled, isJurisdictionPagesEnabled } from '@/lib/flags';
import { needsMfaChallenge } from '@/lib/auth/mfa';
import { safeNextPath } from '@/lib/auth/next-path';

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
  // Where Google/Microsoft sign-in and email confirmation land with their
  // one-time code; the visitor has no session until this route sets one.
  const isAuthCallbackRoute = pathname === '/auth/callback';
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
  // The link-preview images (app/opengraph-image.tsx, app/twitter-image.tsx)
  // are static marketing cards; behind the login redirect, every shared link
  // showed no image.
  const isPublicSeoRoute =
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/opengraph-image' ||
    pathname === '/twitter-image';
  // Privacy policy and terms: public, and linked from the Google/Microsoft
  // sign-in consent screens.
  const isPublicLegalRoute = pathname === '/privacy' || pathname === '/terms';
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
  // Client-facing links emailed to an org's own customers
  // (app/{estimate,invoice,change-order,credit-note,sign,invite}/[token] --
  // invite is a team invitation, whose recipient may not have an account yet). Their
  // recipients never have an account, so redirecting them to /login made
  // every quote, invoice, change order and credit note unopenable. Safe to
  // allow unconditionally: each page authorizes solely by resolving its own
  // bearer token (lib/bridge/client-portal.ts's resolveTargetToken) first and
  // returns the same 404 for any bad, expired, revoked, or flag-disabled
  // token -- the proxy was never their authorization boundary.
  const isPublicClientLinkRoute = /^\/(estimate|invoice|change-order|credit-note|sign|invite)\/[^/]+\/?$/.test(pathname);

  const isMfaRoute = pathname === '/login/mfa';

  // Session API routes (see config.matcher below) keep doing their own auth
  // and return JSON; the proxy only refreshes the session and refuses a
  // session that still owes its two-factor code.
  if (pathname.startsWith('/api/')) {
    if (user && needsMfaChallenge((await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data)) {
      return NextResponse.json({ error: 'Two-factor verification required.' }, { status: 401 });
    }
    return response;
  }

  if (
    !user &&
    !isMfaRoute &&
    !isAuthRoute &&
    !isAuthCallbackRoute &&
    !isPublicMarketingRoute &&
    !isPublicSeoRoute &&
    !isPublicLegalRoute &&
    !isPublicJurisdictionRoute &&
    !isPublicClientLinkRoute
  ) {
    const redirectUrl = new URL('/login', request.url);
    // Back to the page they opened once they've signed in (an emailed
    // application link, a bookmark) -- only for paths safeNextPath allows.
    const next = safeNextPath(pathname);
    if (next) redirectUrl.searchParams.set('next', next);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = new URL(safeNextPath(request.nextUrl.searchParams.get('next')) ?? '/applications', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Signed in, but with an authenticator app set up and no code entered yet
  // this session: every signed-in page and Server Action waits behind the
  // code screen. Public pages (client links, marketing) are unaffected.
  const isPublicRoute =
    isAuthCallbackRoute ||
    isPublicMarketingRoute ||
    isPublicSeoRoute ||
    isPublicLegalRoute ||
    isPublicJurisdictionRoute ||
    isPublicClientLinkRoute;
  if (user && !isMfaRoute && !isPublicRoute) {
    const { data: levels } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (needsMfaChallenge(levels)) {
      return NextResponse.redirect(new URL('/login/mfa', request.url));
    }
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
    // Session-authenticated API routes, for the two-factor check above.
    // Everything else under /api (Inngest, webhooks, the bearer-key public
    // API, token-authorized public PDFs) never carries a user session.
    '/api/(applications|documents|estimates|invoices|payments)/:path*',
  ],
};
