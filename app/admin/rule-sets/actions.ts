'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { buildPublishItems, type LiveRequirement } from '@/lib/sources/rule-set-publish';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

// Rule-set publication (Gate 6.3). Same two gates as app/admin/sources:
// requireAdmin() here, is_platform_admin() inside publish_rule_set_version
// (called with the admin's own session). The jurisdiction comes from the
// permit type row, never from the form; the database builds each snapshot
// from the live requirement row.

export interface RuleSetActionState {
  error?: string;
  message?: string;
  details?: string[];
}

export async function publishRuleSetAction(_prev: RuleSetActionState, formData: FormData): Promise<RuleSetActionState> {
  await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();

  const permitTypeId = z.guid().safeParse(String(formData.get('permitTypeId') ?? ''));
  if (!permitTypeId.success) return { error: 'Invalid permit type.' };
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 2000);

  const service = createServiceClient();
  const [{ data: permitType }, { data: requirements, error: reqError }] = await Promise.all([
    service.from('permit_types').select('id, jurisdiction_id').eq('id', permitTypeId.data).maybeSingle(),
    service
      .from('permit_requirements')
      .select('id, title, description, applies_when')
      .eq('permit_type_id', permitTypeId.data)
      .eq('verification_status', 'verified')
      .is('archived_at', null),
  ]);
  if (!permitType) return { error: 'Permit type not found.' };
  if (reqError) return { error: `Could not load requirements: ${reqError.message}` };

  const live: LiveRequirement[] = (requirements ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    appliesWhen: r.applies_when,
  }));
  const included = new Set(formData.getAll('include').map(String));
  const built = buildPublishItems(
    live,
    live.map((r) => ({ requirementId: r.id, include: included.has(r.id), conditionJson: String(formData.get(`condition:${r.id}`) ?? '') }))
  );
  if (!built.ok) {
    const titles = new Map(live.map((r) => [r.id, r.title]));
    return {
      error: built.errors[0]?.message ?? 'The rule set is not valid.',
      details: [
        ...built.errors.map((e) => (e.requirementId ? `${titles.get(e.requirementId) ?? e.requirementId}: ${e.message}` : e.message)),
        ...(built.problems ?? []).map((p) => p.kind.replaceAll('_', ' ')),
      ],
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('publish_rule_set_version', {
    p_jurisdiction_id: permitType.jurisdiction_id,
    p_permit_type_id: permitTypeId.data,
    p_notes: notes || null,
    p_items: built.items,
  });
  if (error) {
    return {
      error:
        error.code === '42501'
          ? 'Not published: the database does not recognise your account as a platform admin.'
          : `Not published: ${error.message}`,
    };
  }
  revalidatePath('/admin/rule-sets', 'layout');
  return { message: `Published (${built.items.length} requirements). Version id ${String(data).slice(0, 8)}.` };
}
