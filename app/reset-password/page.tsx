import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

// Choose a new password: reached from the reset email (via /auth/confirm,
// which signs the person in) or from Settings -> Security. Outside the (app)
// layout so someone who hasn't finished company setup can still use it.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">{PRODUCT_NAME}</h1>
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Choose a new password</h2>
          <p className="mt-1 text-sm text-zinc-600">For {user.email}. At least 10 characters.</p>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
