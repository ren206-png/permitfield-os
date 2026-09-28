import { requireOrgContext } from '@/lib/auth/org-context';
import { TwoFactorSettings } from './two-factor-settings';

// Security settings: two-factor sign-in with an authenticator app
// (lib/auth/mfa.ts). Per person, not per organization.
export default async function SecuritySettingsPage() {
  await requireOrgContext();
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Security</h1>
      <p className="mt-1 text-sm text-zinc-600">Protect your account with a second step at sign-in.</p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <TwoFactorSettings />
      </div>
    </div>
  );
}
