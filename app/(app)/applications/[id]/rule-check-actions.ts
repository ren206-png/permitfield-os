'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isCopilotRulesEnabled } from '@/lib/flags';
import { recordEnteredFact } from '@/lib/requirements/rules/enter-fact';
import { ensureApplicationProject } from '@/lib/requirements/rules/ensure-project';
import { evaluateApplicationRequirements } from '@/lib/requirements/rules/run';
import { createClient } from '@/lib/supabase/server';

// Gate 6.5 (inherited from 6.2's "readiness extension"): re-runs the
// published rule set for one application from the application page. The
// engine reads everything with the caller's own session (RLS) and is
// gated by PERMITFIELD_FF_COPILOT_RULES inside evaluateApplicationRequirements.

export interface RuleCheckState {
  error?: string;
  message?: string;
}

const CHECK_ERRORS: Record<string, string> = {
  disabled: 'The requirements check is turned off.',
  no_project: 'This application is not linked to a project, so it has no facts to check.',
};

export async function runRuleCheckAction(_prev: RuleCheckState, formData: FormData): Promise<RuleCheckState> {
  if (!isCopilotRulesEnabled()) return { error: CHECK_ERRORS.disabled };
  await requireOrgContext();
  const applicationId = z.guid().safeParse(String(formData.get('applicationId') ?? ''));
  if (!applicationId.success) return { error: 'Invalid application.' };
  if (!(await ensureApplicationProject(await createClient(), applicationId.data))) return { error: 'Invalid application.' };
  const result = await evaluateApplicationRequirements(applicationId.data);
  if (!result.ok) return { error: CHECK_ERRORS[result.error] ?? 'The check could not run.' };
  revalidatePath(`/applications/${applicationId.data}`);
  return { message: `Checked ${result.summary.total} requirements.` };
}

// Answers one project question from the requirements check panel, so the
// check works without the copilot. The answer is a confirmed, user-entered
// project fact (lib/requirements/rules/enter-fact.ts); org and project come
// from the application row the caller's own session can read, never from
// the form. The check re-runs right away so the panel shows the result.
export async function answerRuleQuestionAction(_prev: RuleCheckState, formData: FormData): Promise<RuleCheckState> {
  if (!isCopilotRulesEnabled()) return { error: CHECK_ERRORS.disabled };
  const { userId } = await requireOrgContext();
  const applicationId = z.guid().safeParse(String(formData.get('applicationId') ?? ''));
  if (!applicationId.success) return { error: 'Invalid application.' };

  const supabase = await createClient();
  const { data: application } = await supabase
    .from('permit_applications')
    .select('org_id, project_id')
    .eq('id', applicationId.data)
    .maybeSingle();
  if (!application) return { error: 'Invalid application.' };
  const projectId = application.project_id ?? (await ensureApplicationProject(supabase, applicationId.data));
  if (!projectId) return { error: 'Invalid application.' };

  const saved = await recordEnteredFact(
    supabase,
    { orgId: application.org_id, projectId, userId },
    String(formData.get('factKey') ?? ''),
    String(formData.get('value') ?? '')
  );
  if (!saved.ok) return { error: saved.error };

  const result = await evaluateApplicationRequirements(applicationId.data);
  revalidatePath(`/applications/${applicationId.data}`);
  if (!result.ok) return { message: 'Answer saved. Press "Check again" to update the results.' };
  return { message: 'Answer saved and the requirements re-checked.' };
}
