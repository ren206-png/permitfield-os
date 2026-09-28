// Two-factor sign-in (Supabase TOTP). Someone who has set up an authenticator
// app signs in at assurance level aal1 (password or Google/Microsoft) and must
// enter a code to reach aal2 before using the app -- proxy.ts enforces that
// on every signed-in page, Server Action and session API route.
export interface AssuranceLevels {
  currentLevel: string | null;
  nextLevel: string | null;
}

export function needsMfaChallenge(levels: AssuranceLevels | null | undefined): boolean {
  return Boolean(levels && levels.nextLevel === 'aal2' && levels.currentLevel !== 'aal2');
}

export const MFA_CODE_PATTERN = /^\d{6}$/;
