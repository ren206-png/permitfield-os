import { requireOrgContext } from '@/lib/auth/org-context';
import { NewContractorForm } from './new-contractor-form';

// Reached two ways: the "Contractors" flow directly, or the new-application
// wizard's zero-contractor gate (app/(app)/applications/new/page.tsx), which
// passes ?returnTo=/applications/new so the action can send the user back
// once a contractor exists to select.
export default async function NewContractorPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  await requireOrgContext();
  const { returnTo } = await searchParams;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Add a contractor</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Contractors are the licensed entity a permit application is filed under.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewContractorForm returnTo={returnTo && returnTo.startsWith('/') ? returnTo : undefined} />
      </div>
    </div>
  );
}
