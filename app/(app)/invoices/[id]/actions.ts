'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isClientPortalEnabled, isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { issueInvoice, voidInvoice } from '@/lib/quotes-payments/invoices';
import { recordPayment, reversePayment, type PaymentMethod } from '@/lib/quotes-payments/payments';
import { parseCurrencyToCents } from '@/lib/money/cents';
import { issueTargetToken } from '@/lib/bridge/client-portal';
import { SITE_URL } from '@/lib/seo';

// Gate 4 (Quotes & Payments), Phase A. Same double-gate discipline as
// app/(app)/estimates/[id]/actions.ts's sendEstimateAction: flag re-checked
// first (notFound()), the relevant entitlement re-checked here AND again
// inside the service-layer call itself. Role-based "who may issue/void/
// record/reverse" (is_org_billing_manager()'s RLS/RPC tier) is NOT
// re-implemented here -- the RPCs are the final authority; a member without
// that role gets a thrown Postgres error, caught below and surfaced as a
// plain message, same posture as the estimates action.

export interface IssueInvoiceState {
  error?: string;
  reviewMessage?: string;
}

export async function issueInvoiceAction(
  _prevState: IssueInvoiceState,
  formData: FormData
): Promise<IssueInvoiceState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  if (!invoiceId) {
    return { error: 'Missing invoice id.' };
  }

  const supabase = await createClient();

  let result;
  try {
    result = await issueInvoice(supabase, { orgId, invoiceId, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to issue the invoice.' };
  }

  if (result.status === 'review_required') {
    return { reviewMessage: result.message };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return {};
}

export interface VoidInvoiceState {
  error?: string;
}

export async function voidInvoiceAction(_prevState: VoidInvoiceState, formData: FormData): Promise<VoidInvoiceState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'invoices.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const voidReason = String(formData.get('voidReason') ?? '').trim();
  if (!invoiceId) {
    return { error: 'Missing invoice id.' };
  }

  const supabase = await createClient();

  try {
    await voidInvoice(supabase, { orgId, invoiceId, voidReason: voidReason || null, actorUserId: userId, actorRole: role });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to void the invoice.' };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return {};
}

export interface RecordPaymentState {
  error?: string;
}

const PAYMENT_METHODS: readonly PaymentMethod[] = ['e_transfer', 'cheque'];

export async function recordPaymentAction(
  _prevState: RecordPaymentState,
  formData: FormData
): Promise<RecordPaymentState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'payments.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const clientId = String(formData.get('clientId') ?? '').trim();
  const methodRaw = String(formData.get('method') ?? '').trim();
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const receivedAt = String(formData.get('receivedAt') ?? '').trim();
  const referenceNote = String(formData.get('referenceNote') ?? '').trim();

  if (!invoiceId || !clientId) {
    return { error: 'Missing invoice or client id.' };
  }
  if (!PAYMENT_METHODS.includes(methodRaw as PaymentMethod)) {
    return { error: 'Select a valid payment method.' };
  }
  if (!receivedAt) {
    return { error: 'Received date is required.' };
  }

  const amountCents = parseCurrencyToCents(amountRaw);
  if (amountCents === null || amountCents <= 0n) {
    return { error: 'Enter a valid payment amount.' };
  }

  const supabase = await createClient();

  // Re-derive the client id from the DB rather than trusting the hidden
  // form field, same discipline every other Server Action in this gate
  // follows for foreign keys.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, client_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!invoice || invoice.client_id !== clientId) {
    return { error: 'Invoice not found in your organization.' };
  }

  try {
    await recordPayment(supabase, {
      orgId,
      clientId,
      method: methodRaw as PaymentMethod,
      amountCents,
      receivedAt,
      referenceNote: referenceNote || null,
      allocations: [{ invoiceId, amountCents }],
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to record the payment.' };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return {};
}

export interface ReversePaymentState {
  error?: string;
}

export async function reversePaymentAction(
  _prevState: ReversePaymentState,
  formData: FormData
): Promise<ReversePaymentState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();
  if (!(await can(orgId, 'payments.manage'))) {
    return { error: 'Your organization’s plan does not include Quotes & Payments.' };
  }

  const paymentId = String(formData.get('paymentId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const reversalReason = String(formData.get('reversalReason') ?? '').trim();
  if (!paymentId) {
    return { error: 'Missing payment id.' };
  }

  const supabase = await createClient();

  try {
    await reversePayment(supabase, {
      orgId,
      paymentId,
      reversalReason: reversalReason || null,
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to reverse the payment.' };
  }

  if (invoiceId) {
    revalidatePath(`/invoices/${invoiceId}`);
  }
  return {};
}

// Gate 4 (Quotes & Payments), Phase A -- "Copy client link" action for
// app/(app)/invoices/[id]/page.tsx. Same "separate action, UI-action-layer
// wiring, generate-again supersedes" reasoning as
// app/(app)/estimates/[id]/actions.ts's generateEstimateClientLinkAction --
// see that function's own comment; not re-derived here. A voided invoice
// may still have a link generated for it (the public route renders a void
// notice, same "never blank a voided document" rule
// generateInvoicePdf()'s header comment states) -- only a draft (no issued
// snapshot yet) is rejected below.
export interface GenerateInvoiceClientLinkState {
  error?: string;
  shareUrl?: string;
  expiresAt?: string;
}

export async function generateInvoiceClientLinkAction(
  _prevState: GenerateInvoiceClientLinkState,
  formData: FormData
): Promise<GenerateInvoiceClientLinkState> {
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

  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  if (!invoiceId) {
    return { error: 'Missing invoice id.' };
  }

  const supabase = await createClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, status, clients ( email, name )')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (invoiceError) {
    return { error: `Failed to load invoice: ${invoiceError.message}` };
  }
  if (!invoice) {
    return { error: 'Invoice not found in your organization.' };
  }
  if (invoice.status === 'draft') {
    return { error: 'Issue the invoice before generating a client link.' };
  }

  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;
  const recipientEmail = client?.email;
  if (!recipientEmail) {
    return { error: 'This client has no email on file -- add one before generating a client link.' };
  }

  const result = await issueTargetToken({
    targetKind: 'invoice',
    targetId: invoiceId,
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
        return { error: 'Invoice not found in your organization.' };
      case 'invalid_recipient_email':
        return { error: 'This client’s email on file is not valid -- fix it before generating a client link.' };
      case 'issue_failed':
        return { error: 'Generating the client link failed. Check server logs and try again.' };
    }
  }

  return { shareUrl: `${SITE_URL}/invoice/${result.rawToken}`, expiresAt: result.expiresAt };
}
