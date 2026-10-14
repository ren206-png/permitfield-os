// The password-reset email links to /auth/confirm?token_hash=...&type=recovery
// (Supabase's recovery template). A token hash works in any browser -- unlike
// the PKCE code flow, whose verifier lives only in the browser that asked for
// the email. Returns the token hash, or null when the link isn't a reset link.
export function recoveryTokenHash(params: { token_hash?: unknown; type?: unknown }): string | null {
  const { token_hash: tokenHash, type } = params;
  if (type !== 'recovery' || typeof tokenHash !== 'string') return null;
  return /^[A-Za-z0-9_-]{16,128}$/.test(tokenHash) ? tokenHash : null;
}

export const MIN_PASSWORD_LENGTH = 10;

// Checks a new password before it's sent to Supabase Auth, which enforces
// the same length and also rejects passwords known from data breaches.
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return "The two passwords don't match.";
  return null;
}
