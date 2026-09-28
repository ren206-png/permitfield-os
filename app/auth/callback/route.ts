import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';

// Finishes a sign-in that left the site and came back with a one-time code:
// "Continue with Google/Microsoft", and the link in the email-confirmation
// message after creating an account. Exchanges the code for a session cookie
// (PKCE -- the verifier was stored by the browser when the flow started),
// then goes to the invitation the person came from, if any, else the app.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next ?? '/applications', request.url));
    }
    console.error(`auth/callback: code exchange failed: ${error.message}`);
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('error', 'callback');
  if (next) login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
