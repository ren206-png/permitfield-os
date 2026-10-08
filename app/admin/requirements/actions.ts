'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/admin';
import { parseRequirementEdit } from '@/lib/requirements/review';
import { createServiceClient } from '@/lib/supabase/service-client';

// Requirements review (app/admin/requirements/). Every action re-runs
// requireAdmin() itself, then writes with the service client -- same pattern
// as app/admin/client-portal/actions.ts. verified_by is always the signed-in
// admin, never a form value, and the database still enforces that a verified
// row has a reviewer, a time and a source
// (permit_requirements_verified_requires_all_three).

export interface RequirementActionState {
  error?: string;
  message?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requirementId(formData: FormData): string | null {
  const id = String(formData.get('requirementId') ?? '');
  return UUID_PATTERN.test(id) ? id : null;
}

function refresh() {
  revalidatePath('/admin/requirements', 'layout');
}

export async function verifyRequirementAction(_prev: RequirementActionState, formData: FormData): Promise<RequirementActionState> {
  const admin = await requireAdmin();
  const id = requirementId(formData);
  if (!id) return { error: 'Invalid requirement.' };

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('permit_requirements')
    .update({ verification_status: 'verified', verified_by: admin.id, verified_at: now, updated_at: now })
    .eq('id', id)
    .is('archived_at', null)
    .select('source_id')
    .maybeSingle();
  if (error) return { error: `Could not verify: ${error.message}` };
  if (!data) return { error: 'That requirement is retired or no longer exists.' };

  // Checking an item against its source also confirms the source itself.
  if (data.source_id) {
    const { error: sourceError } = await supabase
      .from('jurisdiction_sources')
      .update({ verification_status: 'verified', verified_by: admin.id, verified_at: now, updated_at: now })
      .eq('id', data.source_id);
    if (sourceError) return { error: `Verified, but the source could not be marked checked: ${sourceError.message}` };
  }
  refresh();
  return { message: 'Verified.' };
}

export async function updateRequirementAction(_prev: RequirementActionState, formData: FormData): Promise<RequirementActionState> {
  await requireAdmin();
  const id = requirementId(formData);
  if (!id) return { error: 'Invalid requirement.' };
  const edit = parseRequirementEdit({
    title: formData.get('title'),
    description: formData.get('description'),
    appliesWhen: formData.get('appliesWhen'),
  });
  if ('error' in edit) return { error: edit.error };

  // An edited requirement needs checking again, so it goes back to pending.
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('permit_requirements')
    .update({
      title: edit.title,
      description: edit.description,
      applies_when: edit.appliesWhen,
      verification_status: 'pending_review',
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return { error: `Could not save: ${error.message}` };
  if (!data) return { error: 'That requirement no longer exists.' };
  refresh();
  return { message: 'Saved. Verify it once you have checked it against the source.' };
}

export async function setRequirementRetiredAction(_prev: RequirementActionState, formData: FormData): Promise<RequirementActionState> {
  await requireAdmin();
  const id = requirementId(formData);
  if (!id) return { error: 'Invalid requirement.' };
  const retire = formData.get('retire') === 'true';

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('permit_requirements')
    .update({ archived_at: retire ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return { error: `Could not update: ${error.message}` };
  if (!data) return { error: 'That requirement no longer exists.' };
  refresh();
  return { message: retire ? 'Retired. New applications will no longer get this item.' : 'Restored.' };
}
