import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { TwoFactorSettings } from './two-factor-settings';

// Security settings: password, and two-factor sign-in with an authenticator
// app (lib/auth/mfa.ts). Per person, not per organization.
export default async function SecuritySettingsPage() {
  await requireOrgContext();
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Security</h1>
      <p className="mt-1 text-sm text-zinc-600">Protect your account with a strong password and a second step at sign-in.</p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Password</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Change the password you sign in with. If you sign in with Google or Microsoft, manage your password there instead.
        </p>
        <Link
          href="/reset-password"
          className="mt-3 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          Change password
        </Link>
      </div>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <TwoFactorSettings />
      </div>
    </div>
  );
}
