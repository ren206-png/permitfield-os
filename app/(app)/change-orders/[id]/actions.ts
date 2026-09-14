'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isClientPortalEnabled, isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { sendChangeOrderForAcceptance, issueChangeOrder, voidChangeOrder } from '@/lib/quotes-payments/change-orders';
import { issueTargetToken } from '@/lib/bridge/client-portal';
import { SITE_URL } from '@/lib/seo';

// Gate 4 (Quotes & Payments), Phase B. Same double-gate discipline as
// app/(app)/estimates/[id]/actions.ts and app/(app)/invoices/[id]/actions.ts:
// flag re-checked first (notFound()), 'invoices.manage' re-checked here AND
// again inside the service-layer call itself. Role-based "who may send/
// issue/void" is NOT re-implemented here -- the RPCs are the final
// authority; a member without the right role gets a thrown Postgres error,
// caught below and surfaced as a plain message.

export interface SendChangeOrderState {
  error?: string;
  reviewMessage?: string;
}

export async function sendChangeOrderForAcceptanceAction(
  _prevState: SendChangeOrderState,
  formData: FormData
): Promise<SendChangeOrderState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const changeOrderId = String(formData.get('changeOrderId') ?? '').trim();
  if (!changeOrderId) {
    return { error: 'Missing change order id.' };
  }

  const supabase = await createClient();

  let result;
  try {
    result = await sendChangeOrderForAcceptance(supabase, { orgId, changeOrderId, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to send the change order for acceptance.' };
  }

  if (result.status === 'review_required') {
    return { reviewMessage: result.message };
  }

  revalidatePath(`/change-orders/${changeOrderId}`);
  return {};
}

export interface IssueChangeOrderState {
  error?: string;
  newInvoiceId?: string;
}

/** Calls issueChangeOrder(), which creates a brand new draft invoice for the accepted delta -- see that function's own header comment in lib/quotes-payments/change-orders.ts for why staff still separately issue that new invoice from its own detail page. This action does not redirect there itself (unlike createChangeOrderAction's redirect on creation) -- the change order's own detail page stays authoritative for "what happened," and links to the new draft invoice once resultingInvoiceId is set, so a staff member reviewing the outcome isn't yanked away before seeing it recorded. */
export async function issueChangeOrderAction(
  _prevState: IssueChangeOrderState,
  formData: FormData
): Promise<IssueChangeOrderState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const changeOrderId = String(formData.get('changeOrderId') ?? '').trim();
  if (!changeOrderId) {
    return { error: 'Missing change order id.' };
  }

  const supabase = await createClient();

  let result;
  try {
    result = await issueChangeOrder(supabase, { orgId, changeOrderId, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to issue the change order.' };
  }

  revalidatePath(`/change-orders/${changeOrderId}`);
  return { newInvoiceId: result.id };
}

export interface VoidChangeOrderState {
  error?: string;
}

export async function voidChangeOrderAction(
  _prevState: VoidChangeOrderState,
  formData: FormData
): Promise<VoidChangeOrderState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const changeOrderId = String(formData.get('changeOrderId') ?? '').trim();
  const voidReason = String(formData.get('voidReason') ?? '').trim();
  if (!changeOrderId) {
    return { error: 'Missing change order id.' };
  }

  const supabase = await createClient();

  try {
    await voidChangeOrder(supabase, { orgId, changeOrderId, voidReason: voidReason || null, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to void the change order.' };
  }

  revalidatePath(`/change-orders/${changeOrderId}`);
  return {};
}

// Gate 4 (Quotes & Payments), Phase B -- "Copy client link" action for the
// lightweight change-order acceptance portal
// (app/change-order/[token]/page.tsx). Same separate-action,
// generate-again-supersedes reasoning as
// app/(app)/estimates/[id]/actions.ts's generateEstimateClientLinkAction and
// app/(app)/invoices/[id]/actions.ts's generateInvoiceClientLinkAction --
// not re-derived here. Only a change order that has actually been sent
// (pending_acceptance or later) has a sent_* snapshot for the portal page to
// render; a draft is rejected below.
export interface GenerateChangeOrderClientLinkState {
  error?: string;
  shareUrl?: string;
  expiresAt?: string;
}

export async function generateChangeOrderClientLinkAction(
  _prevState: GenerateChangeOrderClientLinkState,
  formData: FormData
): Promise<GenerateChangeOrderClientLinkState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }
  if (!isClientPortalEnabled()) {
    return { error: 'The client portal link system (PERMITFIELD_FF_CLIENT_PORTAL) is currently off.' };
  }

  const changeOrderId = String(formData.get('changeOrderId') ?? '').trim();
  if (!changeOrderId) {
    return { error: 'Missing change order id.' };
  }

  const supabase = await createClient();

  const { data: changeOrder, error: changeOrderError } = await supabase
    .from('change_orders')
    .select('id, status, clients ( email, name )')
    .eq('id', changeOrderId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (changeOrderError) {
    return { error: `Failed to load change order: ${changeOrderError.message}` };
  }
  if (!changeOrder) {
    return { error: 'Change order not found in your organization.' };
  }
  if (changeOrder.status === 'draft') {
    return { error: 'Send the change order for acceptance before generating a client link.' };
  }

  const client = Array.isArray(changeOrder.clients) ? changeOrder.clients[0] : changeOrder.clients;
  const recipientEmail = client?.email;
  if (!recipientEmail) {
    return { error: 'This client has no email on file -- add one before generating a client link.' };
  }

  const result = await issueTargetToken({
    targetKind: 'change_order',
    targetId: changeOrderId,
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
        return { error: 'Change order not found in your organization.' };
      case 'invalid_recipient_email':
        return { error: 'This client’s email on file is not valid -- fix it before generating a client link.' };
      case 'issue_failed':
        return { error: 'Generating the client link failed. Check server logs and try again.' };
    }
  }

  return { shareUrl: `${SITE_URL}/change-order/${result.rawToken}`, expiresAt: result.expiresAt };
}
