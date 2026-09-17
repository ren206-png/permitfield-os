import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { ProjectStatusBadge } from '@/components/project-status-badge';
import { ClientDetailCard } from './client-detail-card';

// Same "re-derive org membership + let RLS additionally scope every query"
// discipline as application detail (app/(app)/applications/[id]/page.tsx's
// own header comment) -- a well-formed :id belonging to another org 404s
// here rather than leaking a 403 that would confirm the id exists.
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  await requireOrgContext();
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, email, phone, notes, created_at')
    .eq('id', clientId)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Failed to load client: ${clientError.message}`);
  }
  if (!client) {
    notFound();
  }

  // Properties and projects both carry client_id (20260806000019) -- fetched
  // concurrently since neither depends on the other, same Promise.all shape
  // as the application detail page's own multi-query section.
  const [{ data: properties, error: propertiesError }, { data: projects, error: projectsError }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, address_line1, address_line2, city, province_code, postal_code')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, title, status, created_at')
      .eq('client_id', clientId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
  ]);

  if (propertiesError || projectsError) {
    throw new Error(`Failed to load client detail: ${propertiesError?.message ?? projectsError?.message}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">{client.name}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Client since {new Date(client.created_at).toLocaleDateString()}
        </p>
      </div>

      <ClientDetailCard client={client} />

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Properties</h2>
        {properties && properties.length > 0 ? (
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {properties.map((property) => (
              <li key={property.id} className="px-4 py-2.5 text-sm">
                <p className="text-zinc-900">
                  {property.address_line1}
                  {property.address_line2 ? `, ${property.address_line2}` : ''}
                </p>
                <p className="text-xs text-zinc-500">
                  {property.city}, {property.province_code} {property.postal_code}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No properties on file for this client yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Projects</h2>
        {projects && projects.length > 0 ? (
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-zinc-900">{project.title}</p>
                  <p className="text-xs text-zinc-500">{new Date(project.created_at).toLocaleDateString()}</p>
                </div>
                <ProjectStatusBadge status={project.status} />
              </li>
            ))}
          </ul>
        ) : (
          // No /projects/[id] or /projects list page exists yet (see
          // app/(app)/projects/new/actions.ts's own header comment on this
          // gate's minimal UI scope), so these rows are plain text, not
          // links -- there's nowhere to link to yet.
          <p className="mt-2 text-sm text-zinc-500">No projects for this client yet.</p>
        )}
      </section>
    </div>
  );
}
