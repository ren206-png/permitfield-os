'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { recordChangeOrderAcceptance } from '@/lib/quotes-payments/change-orders';

// Gate 4 (Quotes & Payments), Phase B -- "Accept" action for
// app/change-order/[token]/page.tsx. Same generic-failure discipline as
// app/estimate/[token]/actions.ts's acceptEstimateAction (see that file's
// header comment) -- every token-validation failure below collapses to
// GENERIC_ERROR. The one deliberate exception is the stale-change-order
// case: record_change_order_acceptance() raises a 'stale_change_order:'
// exception when status is no longer 'pending_acceptance' (staff voided it,
// or -- unlike estimates -- there is no revision concept to re-send, so this
// only happens via a void racing the visitor's open tab), and that gets its
// own actionable message instead of the generic one.
const GENERIC_ERROR = 'This link is no longer available. Please contact the sender for an updated link.';

export interface AcceptChangeOrderState {
  error?: string;
  accepted?: boolean;
}

export async function acceptChangeOrderAction(
  _prevState: AcceptChangeOrderState,
  formData: FormData
): Promise<AcceptChangeOrderState> {
  const token = String(formData.get('token') ?? '').trim();
  const typedName = String(formData.get('typedName') ?? '').trim();
  const claimedAuthority = String(formData.get('claimedAuthority') ?? '').trim();

  if (!token) {
    return { error: GENERIC_ERROR };
  }
  if (!typedName || !claimedAuthority) {
    return { error: 'Enter your full name and your role/title to accept this change order.' };
  }

  // Re-validated here, independently of whatever the page component checked
  // moments ago when it rendered -- same "never trust the prior render"
  // contract as acceptEstimateAction.
  const resolved = await resolveTargetToken(token, 'change_order');
  if ('error' in resolved) {
    return { error: GENERIC_ERROR };
  }
  const { orgId, targetId, tokenId, recipientName, recipientEmailDisplay } = resolved;

  // Trust boundary: this service-role client is constructed only after the
  // resolveTargetToken() call above succeeded -- every query below is
  // scoped by the orgId/targetId that call returned, never by a
  // request-supplied value.
  const supabase = createServiceClient();

  const { data: changeOrder, error: changeOrderError } = await supabase
    .from('change_orders')
    .select('id, status, sent_line_items, sent_subtotal_cents, sent_discount_total_cents, sent_tax_total_cents, sent_total_cents')
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (changeOrderError || !changeOrder) {
    return { error: GENERIC_ERROR };
  }
  if (changeOrder.status !== 'pending_acceptance') {
    return { error: 'This change order is no longer open for acceptance.' };
  }

  // snapshotHash: a content fingerprint record_change_order_acceptance()
  // stores verbatim without re-verifying it against anything (mirrors
  // acceptEstimateAction's revisionHash computation exactly) -- sha256 of a
  // deterministic JSON.stringify of the immutable sent_* snapshot this
  // change order was sent with.
  const snapshot = {
    lineItems: changeOrder.sent_line_items,
    totals: {
      subtotal_cents: changeOrder.sent_subtotal_cents,
      discount_total_cents: changeOrder.sent_discount_total_cents,
      tax_total_cents: changeOrder.sent_tax_total_cents,
      total_cents: changeOrder.sent_total_cents,
    },
  };
  const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');

  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
  const userAgent = requestHeaders.get('user-agent');

  const externalActorLabel = recipientName ? `${recipientName} <${recipientEmailDisplay}>` : recipientEmailDisplay;

  try {
    await recordChangeOrderAcceptance(supabase, {
      orgId,
      changeOrderId: changeOrder.id,
      snapshotHash,
      acceptedSnapshot: snapshot,
      typedName,
      claimedAuthority,
      ip,
      userAgent,
      externalActorId: tokenId,
      externalActorLabel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('stale_change_order')) {
      return {
        error: 'This change order has changed since you opened this page. Please refresh and review the latest version before accepting.',
      };
    }
    console.error(`acceptChangeOrderAction failed for change order ${changeOrder.id}: ${message}`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/change-order/${token}`);
  return { accepted: true };
}
