'use server';

import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { recordFilingSubmission, submitFilingByEmail, type SubmitterContext } from '@/lib/submissions/submit';

export interface SubmissionActionState {
  error?: string;
  message?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; ctx: SubmitterContext }> {
  const { orgId, orgName, userId, role } = await requireOrgContext();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, ctx: { orgId, orgName, userId, role, userEmail: user?.email ?? null } };
}

function ids(formData: FormData): { applicationId: string; filingId: string } | null {
  const applicationId = String(formData.get('applicationId') ?? '');
  const filingId = String(formData.get('filingId') ?? '');
  return UUID_PATTERN.test(applicationId) && UUID_PATTERN.test(filingId) ? { applicationId, filingId } : null;
}

export async function emailFilingAction(_prev: SubmissionActionState, formData: FormData): Promise<SubmissionActionState> {
  const target = ids(formData);
  if (!target) return { error: 'Invalid submission.' };
  const { supabase, ctx } = await context();
  const result = await submitFilingByEmail(supabase, ctx, target.applicationId, target.filingId);
  revalidatePath(`/applications/${target.applicationId}`);
  return result.ok ? { message: result.message } : { error: result.error };
}

export async function recordFilingAction(_prev: SubmissionActionState, formData: FormData): Promise<SubmissionActionState> {
  const target = ids(formData);
  const method = String(formData.get('method') ?? '');
  if (!target || (method !== 'portal' && method !== 'in_person')) return { error: 'Invalid submission.' };
  const { supabase, ctx } = await context();
  const result = await recordFilingSubmission(
    supabase,
    ctx,
    target.applicationId,
    target.filingId,
    method,
    String(formData.get('externalReference') ?? '')
  );
  revalidatePath(`/applications/${target.applicationId}`);
  return result.ok ? { message: result.message } : { error: result.error };
}
