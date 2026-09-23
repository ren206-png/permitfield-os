'use server';

import { redirect } from 'next/navigation';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isQuotesPaymentsOnlineEnabled } from '@/lib/flags';
import { dbValueToCents, dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { getOrgStripeConnectAccountStatus, createInvoiceCheckoutSessionUrl } from '@/lib/quotes-payments/stripe-connect';
import { SITE_URL } from '@/lib/seo';

// Gate 4 (Quotes & Payments), Phase C -- "Pay now" action for
// app/invoice/[token]/page.tsx. Same generic-failure discipline
// app/estimate/[token]/actions.ts's acceptEstimateAction already established
// for this token-validated, no-session surface: every token/state failure
// below collapses to GENERIC_ERROR. Deliberately does NOT call
// assertOnlinePaymentsEntitlement()/can(orgId, 'payments.online') anywhere
// in this file -- per GATE_4_PHASE_C_FINDINGS.md §I question 3, the visitor
// clicking this button is a customer, not an org member, and has no actor
// shape `can()` could evaluate at all. Gated instead by
// isQuotesPaymentsOnlineEnabled() plus the data-level precondition
// (a connected, charges-enabled Stripe account exists for this org) checked
// inline below.
//
// Every value handed to createInvoiceCheckoutSessionUrl() is re-derived
// here from the token-validated orgId/targetId, never trusted from the
// submitted form -- same "the caller must validate first" contract as
// acceptEstimateAction's own header comment.
const GENERIC_ERROR = 'This link is no longer available. Please contact the sender for an updated link.';

export interface PayInvoiceState {
  error?: string;
}

export async function payInvoiceAction(_prevState: PayInvoiceState, formData: FormData): Promise<PayInvoiceState> {
  if (!isQuotesPaymentsOnlineEnabled()) {
    return { error: 'Online payment is not currently available for this invoice.' };
  }

  const token = String(formData.get('token') ?? '').trim();
  if (!token) {
    return { error: GENERIC_ERROR };
  }

  const resolved = await resolveTargetToken(token, 'invoice');
  if ('error' in resolved) {
    return { error: GENERIC_ERROR };
  }
  const { orgId, targetId } = resolved;

  // Trust boundary: same "service-role client constructed only after token
  // validation" contract as app/invoice/[token]/page.tsx and
  // app/estimate/[token]/actions.ts.
  const supabase = createServiceClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, status, invoice_number, issued_total_cents, client_id, clients ( email )')
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return { error: GENERIC_ERROR };
  }
  if (invoice.status !== 'issued') {
    return { error: 'This invoice is not open for online payment.' };
  }

  const connectAccount = await getOrgStripeConnectAccountStatus(supabase, orgId);
  if (!connectAccount || !connectAccount.chargesEnabled) {
    return {
      error: 'Online payment is not currently set up for this invoice. Please contact the sender for payment instructions.',
    };
  }

  // Outstanding-balance recomputation -- same three-term formula
  // (issued_total_cents - recorded payments - issued credit notes) as
  // app/invoice/[token]/page.tsx's own read-side calculation (no shared
  // helper exists yet, per that file's own header comment on this exact
  // duplication). Recomputed independently here rather than trusted from a
  // hidden form field, since a stale page render must never determine how
  // much this action actually charges.
  const { data: allocationRows, error: allocationsError } = await supabase
    .from('payment_allocations')
    .select('amount_cents, payments ( status )')
    .eq('org_id', orgId)
    .eq('invoice_id', targetId);
  if (allocationsError) {
    return { error: GENERIC_ERROR };
  }
  let paidCents = 0n;
  for (const row of allocationRows ?? []) {
    const payment = Array.isArray(row.payments) ? row.payments[0] : row.payments;
    if (payment?.status === 'recorded') {
      paidCents += dbValueToCents(row.amount_cents);
    }
  }

  const { data: creditNoteRows, error: creditNotesError } = await supabase
    .from('credit_notes')
    .select('issued_amount_cents')
    .eq('org_id', orgId)
    .eq('invoice_id', targetId)
    .eq('status', 'issued');
  if (creditNotesError) {
    return { error: GENERIC_ERROR };
  }
  const issuedCreditsCents = (creditNoteRows ?? []).reduce(
    (sum, cn) => sum + (dbValueToCentsOrNull(cn.issued_amount_cents) ?? 0n),
    0n
  );

  const issuedTotalCents = dbValueToCentsOrNull(invoice.issued_total_cents) ?? 0n;
  const outstandingCents = issuedTotalCents - paidCents - issuedCreditsCents;
  if (outstandingCents <= 0n) {
    return { error: 'This invoice has no outstanding balance.' };
  }

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;

  let checkoutUrl: string;
  try {
    checkoutUrl = await createInvoiceCheckoutSessionUrl({
      orgId,
      stripeConnectAccountId: connectAccount.stripeConnectAccountId,
      invoiceId: targetId,
      clientId: invoice.client_id,
      amountCents: outstandingCents,
      invoiceLabel: invoice.invoice_number !== null ? `Invoice #${invoice.invoice_number}` : 'Invoice',
      customerEmail: client?.email ?? null,
      successUrl: `${SITE_URL}/invoice/${token}?payment=success`,
      cancelUrl: `${SITE_URL}/invoice/${token}?payment=canceled`,
    });
  } catch (error) {
    console.error(`payInvoiceAction failed for invoice ${targetId}: ${error instanceof Error ? error.message : String(error)}`);
    return { error: 'Unable to start online payment right now. Please try again later or contact the sender.' };
  }

  // Outside the try/catch on purpose -- redirect() throws a Next.js-internal
  // control-flow signal a catch block here would otherwise swallow, same
  // discipline as app/(app)/settings/billing/actions.ts's checkoutAction.
  redirect(checkoutUrl);
}
