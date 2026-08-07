'use server';

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isIntakeEnabled } from '@/lib/flags';
import { can } from '@/lib/authz';
import { can as entitlementCan, limit } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import { CreateProjectFormSchema } from '@/lib/intake/schemas';

// Lifecycle & Compliance Expansion, Phase 1.1: the createProject Server
// Action. This is the first call site in this codebase for THREE
// foundation modules that have shipped with zero callers until now:
//   - lib/authz's can() (Phase 1.0) -- checked below before any DB write.
//   - lib/entitlements's can()/limit() (this phase) -- checked after authz,
//     before the DB write, using a live count query against `projects`
//     (entitlements itself stays DB-free/pure, same as lib/authz -- see
//     that module's header comment).
//   - lib/audit/log.ts's writeAuditLog() (Phase 1.0) -- called after a
//     successful insert, describing the actor's own action.
// None of those three modules changed behavior when they shipped; this
// action is what finally wires them together, and it does so entirely
// behind isIntakeEnabled() -- flag off means this route 404s before any of
// the above runs, so shipping this file does not change behavior for any
// environment that hasn't explicitly turned the flag on.
export interface NewProjectState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createProjectAction(
  _prevState: NewProjectState,
  formData: FormData
): Promise<NewProjectState> {
  if (!isIntakeEnabled()) {
    notFound();
  }

  const { userId, orgId, role } = await requireOrgContext();

  // requireOrgContext()'s OrgContext.role is typed 'owner' | 'member' (the
  // two legacy values -- see that file's own header comment on why: no org
  // switcher / new-role assignment UI exists yet). That's a subtype of
  // lib/authz's full Role union, so it's a safe, unwidened argument here.
  if (!can(role, 'create', 'projects')) {
    return { error: 'You do not have permission to create a project.' };
  }

  const parsed = CreateProjectFormSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    taxonomyId: formData.get('taxonomyId'),
    propertyOwnerName: formData.get('propertyOwnerName'),
    applicantName: formData.get('applicantName'),
    status: formData.get('status') || undefined,
    clientName: formData.get('clientName'),
    clientEmail: formData.get('clientEmail'),
    clientPhone: formData.get('clientPhone'),
    addressLine1: formData.get('addressLine1'),
    addressLine2: formData.get('addressLine2'),
    city: formData.get('city'),
    provinceCode: formData.get('provinceCode'),
    postalCode: formData.get('postalCode'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: 'Please fix the errors below.', fieldErrors };
  }

  const data = parsed.data;

  if (!entitlementCan(orgId, 'projects.create')) {
    return { error: 'Project creation is not available for this organization.' };
  }

  const supabase = await createClient();

  // Live count, not a cached figure -- same "never trust stale state for a
  // limit check" discipline requireOrgContext's own header comment
  // documents for org membership.
  const { count, error: countError } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('archived_at', null);

  if (countError) {
    return { error: `Failed to check project limit: ${countError.message}` };
  }

  const maxActiveProjects = limit(orgId, 'projects.active_max');
  if ((count ?? 0) >= maxActiveProjects) {
    return {
      error: `This organization has reached its limit of ${maxActiveProjects} active projects.`,
    };
  }

  // Inline client/property creation -- see lib/intake/schemas.ts's header
  // comment on CreateProjectFormSchema for why: no standalone /clients/new
  // or /properties/new page exists in this gate, so this is the only entry
  // point that can populate those two tables at all today. Both are
  // optional; a project can be created with neither.
  let clientId: string | null = null;
  if (data.clientName) {
    const { data: clientRow, error: clientError } = await supabase
      .from('clients')
      .insert({
        org_id: orgId,
        name: data.clientName,
        email: data.clientEmail ?? null,
        phone: data.clientPhone ?? null,
      })
      .select('id')
      .single();
    if (clientError) {
      return { error: `Failed to create client: ${clientError.message}` };
    }
    clientId = clientRow.id;
  }

  // CreateProjectFormSchema's superRefine already guarantees these four are
  // either all present or all absent.
  let propertyId: string | null = null;
  if (data.addressLine1 && data.city && data.provinceCode && data.postalCode) {
    const { data: propertyRow, error: propertyError } = await supabase
      .from('properties')
      .insert({
        org_id: orgId,
        client_id: clientId,
        address_line1: data.addressLine1,
        address_line2: data.addressLine2 ?? null,
        city: data.city,
        province_code: data.provinceCode,
        postal_code: data.postalCode,
      })
      .select('id')
      .single();
    if (propertyError) {
      return { error: `Failed to create property: ${propertyError.message}` };
    }
    propertyId = propertyRow.id;
  }

  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .insert({
      org_id: orgId,
      client_id: clientId,
      property_id: propertyId,
      taxonomy_id: data.taxonomyId ?? null,
      title: data.title,
      description: data.description ?? null,
      property_owner_name: data.propertyOwnerName ?? null,
      applicant_name: data.applicantName ?? null,
      status: data.status,
    })
    .select('id')
    .single();

  if (projectError) {
    return { error: `Failed to create project: ${projectError.message}` };
  }

  // writeAuditLog() returns its error rather than throwing (see that file's
  // header comment) precisely so a ledger-write failure never takes down
  // the primary action -- the project above is already committed.
  const { error: auditError } = await writeAuditLog(supabase, {
    orgId,
    actorUserId: userId,
    actorRole: role,
    action: 'project.created',
    entityType: 'projects',
    entityId: projectRow.id,
    afterSummary: { title: data.title, status: data.status },
  });
  if (auditError) {
    console.error('Failed to write audit log for project.created:', auditError);
  }

  // No /projects/[id] or /projects list page exists in this gate (minimal
  // UI scope -- see the Phase 1.1 report); redirect to the existing
  // /applications landing page rather than a route that doesn't exist yet.
  redirect('/applications');
}
