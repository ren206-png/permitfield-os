'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isClientPortalEnabled, isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { sendEstimate } from '@/lib/quotes-payments/estimates';
import { issueTargetToken } from '@/lib/bridge/client-portal';
import { SITE_URL } from '@/lib/seo';

// Gate 4 (Quotes & Payments), Phase A. Same double-gate discipline as
// app/(app)/estimates/new/actions.ts: flag re-checked first (notFound()),
// 'quotes.manage' entitlement re-checked here AND inside sendEstimate()
// itself. Role-based "who may send" (is_org_billing_manager()'s wider
// owner/org_owner/platform_admin/permit_manager tier, 20260806000052's own
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

// Gate 4 (Quotes & Payments), Phase A -- "Copy client link" action for
// app/(app)/estimates/[id]/page.tsx. Deliberately a SEPARATE action from
// sendEstimateAction above rather than folded into it: this lets staff
// (re)generate a fresh link at any time after sending (e.g. once a
// previous 14-day link has expired), not only once, at send time. Wiring
// choice stated explicitly per this pass's own task framing: token
// issuance for estimates is triggered from this UI-action layer, not from
// inside lib/quotes-payments/estimates.ts's sendEstimate() itself, so that
// module keeps zero knowledge of the client-portal bridge.
//
// The raw token is only ever returned here, once, in this action's return
// value -- never persisted, never logged, matching issueTargetToken()'s own
// (and issueToken()'s) contract. A page reload loses it; generating again
// supersedes the previous link (see issueTargetToken()'s own supersede
// step), which is the intended behavior, not a bug -- an org member who
// lost the link regenerates rather than needing to recover the old one.
export interface GenerateEstimateClientLinkState {
  error?: string;
  shareUrl?: string;
  expiresAt?: string;
}

export async function generateEstimateClientLinkAction(
  _prevState: GenerateEstimateClientLinkState,
  formData: FormData
): Promise<GenerateEstimateClientLinkState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId } = await requireOrgContext();
  if (!(await can(orgId, 'quotes.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }
  if (!isClientPortalEnabled()) {
    return { error: 'The client portal link system (PERMITFIELD_FF_CLIENT_PORTAL) is currently off.' };
  }

  const estimateId = String(formData.get('estimateId') ?? '').trim();
  if (!estimateId) {
    return { error: 'Missing estimate id.' };
  }

  const supabase = await createClient();

  // Re-derived from the DB, not trusted from a hidden form field -- same
  // discipline recordPaymentAction's own comment describes. `status` gates
  // "has this ever been sent" (a draft has no revision snapshot for the
  // public route to render); the client's email is the token's required
  // recipient identity.
  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('id, status, clients ( email, name )')
    .eq('id', estimateId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (estimateError) {
    return { error: `Failed to load estimate: ${estimateError.message}` };
  }
  if (!estimate) {
    return { error: 'Estimate not found in your organization.' };
  }
  if (estimate.status === 'draft') {
    return { error: 'Send the estimate before generating a client link.' };
  }

  const client = Array.isArray(estimate.clients) ? estimate.clients[0] : estimate.clients;
  const recipientEmail = client?.email;
  if (!recipientEmail) {
    return { error: 'This client has no email on file -- add one before generating a client link.' };
  }

  const result = await issueTargetToken({
    targetKind: 'estimate',
    targetId: estimateId,
    orgId,
    recipientEmail,
    recipientName: client?.name ?? null,
    issuedByOrgUserId: userId,
  });

  if ('error' in result) {
    switch (result.error) {
      case 'client_portal_disabled':
        return { error: 'The client portal link system (PERMITFIELD_FF_CLIENT_PORTAL) is currently off.' };
      case 'quotes_payments_disabled':
        return { error: 'Quotes & Payments is currently off.' };
      case 'target_not_found':
        return { error: 'Estimate not found in your organization.' };
      case 'invalid_recipient_email':
        return { error: 'This client’s email on file is not valid -- fix it before generating a client link.' };
      case 'issue_failed':
        return { error: 'Generating the client link failed. Check server logs and try again.' };
    }
  }

  return { shareUrl: `${SITE_URL}/estimate/${result.rawToken}`, expiresAt: result.expiresAt };
}
