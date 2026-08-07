import { createBrowserClient } from '@supabase/ssr';

// Browser-context Supabase client -- for Client Components that need direct
// auth calls (sign in / sign up / sign out) where the round-trip of a Route
// Handler adds nothing: @supabase/ssr's browser client reads/writes the same
// cookie-based session that lib/supabase/server.ts reads on the server, so a
// client-side auth.signInWithPassword() call is immediately visible to the
// next Server Component render (after router.refresh()), no custom session
// bridging required. Every *data* mutation in this app still goes through a
// Route Handler or Server Action using lib/supabase/server.ts, never this
// client -- this file exists for auth state only.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
