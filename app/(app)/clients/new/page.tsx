import { requireOrgContext } from '@/lib/auth/org-context';
import { NewClientForm } from './new-client-form';

export default async function NewClientPage() {
  await requireOrgContext();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Add a client</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Clients can be reused across multiple projects over time.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <NewClientForm />
      </div>
    </div>
  );
}
