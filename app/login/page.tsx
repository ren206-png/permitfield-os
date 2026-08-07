import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME, LEGAL_DISCLAIMER } from '@/lib/brand';
import { LoginForm } from './login-form';

// Server Component shell only -- the actual sign-in/sign-up interaction runs
// client-side (login-form.tsx) against lib/supabase/client.ts, since Supabase
// password auth's whole point is that the browser talks to Supabase Auth
// directly rather than proxying credentials through our own Route Handler
// (this app never touches a password's plaintext server-side, consistent
// with the "never enter credentials into a field you don't own" instinct
// this whole product is built to encourage in contractors dealing with
// permit portals).
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect('/applications');
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">
          {PRODUCT_NAME}
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-600">
          Permitting and local compliance copilot for Canadian trade contractors.
        </p>
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-zinc-500">{LEGAL_DISCLAIMER}</p>
      </div>
    </div>
  );
}
