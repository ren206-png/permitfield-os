'use client';

import { useState } from 'react';
import { EditClientForm } from './edit-client-form';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

// Thin client-side view/edit toggle around the server-fetched client row --
// kept as its own component (rather than making the whole detail page a
// client component) so every other section of the page (properties,
// projects) stays a plain server-rendered read, same "client component only
// for the interactive slice" shape as document-upload.tsx /
// review-actions.tsx on the application detail page.
export function ClientDetailCard({ client }: { client: Client }) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <EditClientForm client={client} onDone={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Email</dt>
            <dd className="text-zinc-900">{client.email ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Phone</dt>
            <dd className="text-zinc-900">{client.phone ?? 'Not provided'}</dd>
          </div>
          {client.notes && (
            <div className="sm:col-span-2">
              <dt className="text-zinc-500">Notes</dt>
              <dd className="whitespace-pre-wrap text-zinc-900">{client.notes}</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="flex-shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
