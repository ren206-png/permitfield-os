import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isMarketingV2Enabled } from '@/lib/flags';

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

  if (!user && !isAuthRoute && !isPublicMarketingRoute) {
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
