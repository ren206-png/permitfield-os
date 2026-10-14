// Which "Continue with…" buttons the login page shows: the OAuth providers
// switched on in the Supabase project (Authentication → Providers), read from
// its public settings endpoint. A provider appears as soon as it is enabled
// there -- no deploy or flag needed -- and disappears if it's turned off.
export type OAuthProvider = 'google' | 'azure';

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  azure: 'Microsoft',
};

const SUPPORTED: OAuthProvider[] = ['google', 'azure'];

export function enabledProvidersFromSettings(settings: unknown): OAuthProvider[] {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external ?? {};
  return SUPPORTED.filter((provider) => external[provider] === true);
}

export async function fetchEnabledOAuthProviders(): Promise<OAuthProvider[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return [];
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, next: { revalidate: 300 } });
    if (!response.ok) return [];
    return enabledProvidersFromSettings(await response.json());
  } catch {
    // Settings unreachable: show email sign-in only, never a broken button.
    return [];
  }
}

// Sign in with Apple, used only by the iPhone app's native sheet
// (ios/App/App/AppleSignInPlugin.swift -> signInWithIdToken). Enabled when
// the Apple provider is on in Supabase with the app's bundle id
// (com.rennerkargbo.permitfieldos) as a client id. The website doesn't offer
// it: the web flow also needs an Apple Services ID and secret key.
export async function fetchAppleSignInEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, next: { revalidate: 300 } });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: Record<string, unknown> } | null;
    return settings?.external?.apple === true;
  } catch {
    return false;
  }
}
