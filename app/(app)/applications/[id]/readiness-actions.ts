'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { can } from '@/lib/entitlements';
import { isReadinessEnabled } from '@/lib/flags';
import { ALL_PERMIT_STATUSES, type PermitStatus } from '@/lib/permit-status/transitions';
import { addSuggestedChecklistItems } from '@/lib/readiness/add-suggested-items';
import { MIN_OVERRIDE_REASON_LENGTH, permitStatusErrorMessage } from '@/lib/readiness/readiness';
import { createClient } from '@/lib/supabase/server';

// "Permit progress" panel actions (PERMITFIELD_FF_READINESS). Checklist rows
// are written directly under readiness_checklist_items' RLS (any org member;
// delete is owner-only); the status move and the override go through their
// SECURITY DEFINER functions, which re-check role, legality and readiness.

export interface ReadinessActionState {
  error?: string;
  message?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(formData: FormData, name: string, max: number): string {
  return String(formData.get(name) ?? '').trim().slice(0, max);
}

async function context(applicationId: string) {
  if (!isReadinessEnabled()) return { error: 'Permit progress tracking is currently off.' } as const;
  if (!UUID_PATTERN.test(applicationId)) return { error: 'Invalid application.' } as const;
  const { orgId, userId } = await requireOrgContext();
  if (!(await can(orgId, 'readiness.checker'))) {
    return { error: 'Your organization’s plan does not include the readiness checklist.' } as const;
  }
  return { orgId, userId, supabase: await createClient() } as const;
}

function done(applicationId: string, state: ReadinessActionState): ReadinessActionState {
  revalidatePath(`/applications/${applicationId}`);
  return state;
}

export async function addChecklistItemAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };

  const title = text(formData, 'title', 200);
  if (!title) return { error: 'Give the item a title.' };
  const dueDate = text(formData, 'dueDate', 10);
  if (dueDate && !DATE_PATTERN.test(dueDate)) return { error: 'Enter the due date as YYYY-MM-DD.' };

  const { error } = await ctx.supabase.from('readiness_checklist_items').insert({
    org_id: ctx.orgId,
    application_id: applicationId,
    title,
    description: text(formData, 'description', 1000) || null,
    is_required: formData.get('isRequired') === 'on',
    responsible_party: text(formData, 'responsibleParty', 200) || null,
    due_date: dueDate || null,
  });
  if (error) return { error: `Could not add the item: ${error.message}` };
  return done(applicationId, { message: 'Item added.' });
}

export async function addSuggestedItemsAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };

  const { data: application } = await ctx.supabase
    .from('permit_applications')
    .select('permit_type_id')
    .eq('id', applicationId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!application) return { error: 'Application not found.' };

  const result = await addSuggestedChecklistItems(ctx.supabase, {
    orgId: ctx.orgId,
    applicationId,
    permitTypeId: application.permit_type_id,
  });
  if ('error' in result) return { error: `Could not add the suggested items: ${result.error}` };
  if (result.added === 0) return { message: 'The suggested items are already on the checklist.' };
  return done(applicationId, { message: `Added ${result.added} item${result.added === 1 ? '' : 's'}.` });
}

export async function setChecklistItemStatusAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const status = String(formData.get('status') ?? '');
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };
  if (!UUID_PATTERN.test(itemId) || !['pending', 'complete', 'rejected'].includes(status)) return { error: 'Invalid item.' };

  const rejectionReason = text(formData, 'rejectionReason', 500);
  if (status === 'rejected' && !rejectionReason) return { error: 'Say why it was rejected.' };
  const reviewed = status !== 'pending';

  const { data, error } = await ctx.supabase
    .from('readiness_checklist_items')
    .update({
      status,
      reviewed_by: reviewed ? ctx.userId : null,
      reviewed_at: reviewed ? new Date().toISOString() : null,
      rejection_reason: status === 'rejected' ? rejectionReason : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('org_id', ctx.orgId)
    .eq('application_id', applicationId)
    .select('id');
  if (error) return { error: `Could not update the item: ${error.message}` };
  if (!data?.length) return { error: 'Item not found.' };
  return done(applicationId, {});
}

export async function deleteChecklistItemAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };
  if (!UUID_PATTERN.test(itemId)) return { error: 'Invalid item.' };

  // RLS limits delete to the org owner; a non-owner's delete matches no rows.
  const { data, error } = await ctx.supabase
    .from('readiness_checklist_items')
    .delete()
    .eq('id', itemId)
    .eq('org_id', ctx.orgId)
    .select('id');
  if (error) return { error: `Could not delete the item: ${error.message}` };
  if (!data?.length) return { error: 'Only the owner can delete checklist items. Mark it rejected or optional instead.' };
  return done(applicationId, {});
}

export async function overrideReadinessAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };
  if (!(await can(ctx.orgId, 'readiness.override'))) {
    return { error: 'Your organization’s plan does not include readiness overrides.' };
  }
  const reason = text(formData, 'reason', 1000);
  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    return { error: `Give a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters.` };
  }

  const { error } = await ctx.supabase.rpc('override_readiness_check', { p_application_id: applicationId, p_reason: reason });
  if (error) return { error: permitStatusErrorMessage(error.message) };
  return done(applicationId, { message: 'Override recorded. It stays on the application’s record.' });
}

export async function transitionPermitStatusAction(_prev: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const toStatus = String(formData.get('toStatus') ?? '') as PermitStatus;
  const ctx = await context(applicationId);
  if ('error' in ctx) return { error: ctx.error };
  if (!ALL_PERMIT_STATUSES.includes(toStatus) || toStatus === 'submitted') return { error: 'Invalid status.' };

  const { error } = await ctx.supabase.rpc('transition_permit_status', {
    p_application_id: applicationId,
    p_to_status: toStatus,
    p_reason: text(formData, 'reason', 500) || null,
    p_request_key: randomUUID(),
  });
  if (error) return { error: permitStatusErrorMessage(error.message) };
  return done(applicationId, {});
}
