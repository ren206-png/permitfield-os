import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/org-context';
import { OnboardingForm } from './onboarding-form';

// Reached only when a signed-in user has zero org_members rows
// (lib/auth/org-context.ts's requireOrgContext redirects here). If they've
// since gained a membership -- e.g. they were invited to an existing org in
// another tab while this one was open -- send them straight to the app
// instead of letting them create a redundant second org.
export default async function OnboardingPage() {
  const user = await requireUser();

  const supabase = await createClient();
  const { data: existingMembership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (existingMembership) {
    redirect('/applications');
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-zinc-900">
          Set up your organization
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-600">
          One more step before you can start a permit application.
        </p>
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <OnboardingForm />
        </div>
      </div>
    </div>
  );
}
