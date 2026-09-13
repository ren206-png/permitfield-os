'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { sendEstimate } from '@/lib/quotes-payments/estimates';

// Gate 4 (Quotes & Payments), Phase A. Same double-gate discipline as
// app/(app)/estimates/new/actions.ts: flag re-checked first (notFound()),
// 'quotes.manage' entitlement re-checked here AND inside sendEstimate()
// itself. Role-based "who may send" (is_org_billing_manager()'s wider
// owner/org_owner/platform_admin/permit_manager tier, 20260806000045's own
// RLS) is NOT re-implemented here -- send_estimate()'s own RPC/RLS is the
// final authority; a member without that role gets a thrown Postgres error
// from the RPC, caught below and surfaced as a plain message, same "let
// RLS/RPC be the real enforcement" posture app/(app)/settings/billing/
// actions.ts's Checkout/Portal actions already follow.
export interface SendEstimateState {
  error?: string;
  reviewMessage?: string;
}

export async function sendEstimateAction(
  _prevState: SendEstimateState,
  formData: FormData
): Promise<SendEstimateState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'quotes.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const estimateId = String(formData.get('estimateId') ?? '').trim();
  if (!estimateId) {
    return { error: 'Missing estimate id.' };
  }

  const supabase = await createClient();

  let result;
  try {
    result = await sendEstimate(supabase, { orgId, estimateId, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to send the estimate.' };
  }

  if (result.status === 'review_required') {
    return { reviewMessage: result.message };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}
