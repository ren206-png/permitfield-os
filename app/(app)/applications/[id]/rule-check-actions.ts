'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/org-context';
import { evaluateApplicationRequirements } from '@/lib/requirements/rules/run';

// Gate 6.5 (inherited from 6.2's "readiness extension"): re-runs the
// published rule set for one application from the application page. The
// engine reads everything with the caller's own session (RLS) and is
// gated by PERMITFIELD_FF_COPILOT_RULES inside evaluateApplicationRequirements.

export interface RuleCheckState {
  error?: string;
  message?: string;
}

export async function runRuleCheckAction(_prev: RuleCheckState, formData: FormData): Promise<RuleCheckState> {
  await requireOrgContext();
  const applicationId = z.guid().safeParse(String(formData.get('applicationId') ?? ''));
  if (!applicationId.success) return { error: 'Invalid application.' };
  const result = await evaluateApplicationRequirements(applicationId.data);
  if (!result.ok) {
    const messages: Record<string, string> = {
      disabled: 'The requirements check is turned off.',
      no_project: 'This application is not linked to a project, so it has no facts to check.',
    };
    return { error: messages[result.error] ?? 'The check could not run.' };
  }
  revalidatePath(`/applications/${applicationId.data}`);
  return { message: `Checked ${result.summary.total} requirements.` };
}
