import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// User-context Supabase client for Route Handlers and Server Components --
// runs with the calling user's session, so every query goes through RLS
// exactly as it would from the browser. This is the client any route acting
// on behalf of a signed-in contractor must use (e.g. app/api/documents/route.ts).
// Never use this for background jobs -- there is no user session in an
// Inngest function; use lib/supabase/service-client.ts there instead.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Thrown when called from a context that can't set cookies
            // (e.g. a Server Component render). Safe to ignore as long as
            // session refresh is also happening in middleware.
          }
        },
      },
    }
  );
}
