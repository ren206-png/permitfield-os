import Link from 'next/link';
import { PRODUCT_NAME } from '@/lib/brand';
import { recoveryTokenHash } from '@/lib/auth/recovery';
import { confirmRecoveryAction } from './actions';

// Where the password-reset email lands. Shows a Continue button instead of
// acting on the GET (see confirmRecoveryAction for why).
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const params = await searchParams;
  const tokenHash = recoveryTokenHash(params);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">{PRODUCT_NAME}</h1>
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          {tokenHash ? (
            <form action={confirmRecoveryAction} className="flex flex-col gap-4">
              <h2 className="text-base font-semibold text-zinc-900">Reset your password</h2>
              <p className="text-sm text-zinc-600">Continue to choose a new password for your account.</p>
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value="recovery" />
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
              >
                Continue
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-sm text-red-600">
                This link isn&apos;t valid. Ask for a new one from the sign-in page.
              </p>
              <Link href="/login" className="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900">
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
