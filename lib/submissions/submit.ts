import type { SupabaseClient } from '@supabase/supabase-js';
import { isCitySubmissionEnabled } from '@/lib/flags';
import { writeAuditLog } from '@/lib/audit/log';
import { sendEmail } from '@/lib/email/send';
import { GENERATED_BUCKET, UPLOADS_BUCKET } from '@/lib/storage/documents';
import type { Role } from '@/lib/authz';
import { buildSubmissionEmail } from './email';
import { resolveSubmissionRecipient } from './recipient';

// Server-side orchestration for filing one permit_type_filing with its
// authority. Every query runs on the caller's session client, so RLS scopes
// it to the caller's org; filing_submissions' insert policy additionally
// requires a submission-tier role (can_submit_filings()), which is checked
// up front because an email cannot be unsent.

// Signed download links for drawings/documents embedded in the email.
export const DOCUMENT_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

// Resend's documented per-email attachment cap is 40 MB; the filled form is
// the only attachment and is far below this, but refuse rather than let the
// provider reject it after the fact.
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

type Client = SupabaseClient;

export interface SubmitterContext {
  orgId: string;
  orgName: string;
  userId: string;
  userEmail: string | null;
  role: Role;
}

export type SubmitResult = { ok: true; message: string } | { ok: false; error: string };

interface LoadedFiling {
  application: {
    id: string;
    status: string;
    permit_status: string;
    project_address: string;
    contractorCompanyName: string | null;
  };
  filingId: string;
  permitTypeTitle: string;
  authority: {
    id: string;
    name: string;
    filing_mechanism: string | null;
    submission_email: string | null;
  };
}

const SUBMITTABLE_STATUSES = new Set(['documents_generated', 'submitted']);

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadFiling(supabase: Client, orgId: string, applicationId: string, filingId: string): Promise<LoadedFiling | { error: string }> {
  const { data: application, error: appError } = await supabase
    .from('permit_applications')
    .select('id, status, permit_status, project_address, permit_type_id, contractors ( company_name )')
    .eq('id', applicationId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (appError) return { error: `Could not load the application: ${appError.message}` };
  if (!application) return { error: 'Application not found.' };
  if (!SUBMITTABLE_STATUSES.has(application.status)) {
    return { error: 'Generate the filled documents before submitting this application.' };
  }

  const { data: filing, error: filingError } = await supabase
    .from('permit_type_filings')
    .select('id, permit_type_id, permit_types ( title ), authorities ( id, name, filing_mechanism, submission_email )')
    .eq('id', filingId)
    .eq('permit_type_id', application.permit_type_id)
    .maybeSingle();
  if (filingError) return { error: `Could not load the filing: ${filingError.message}` };
  const authority = first(filing?.authorities as LoadedFiling['authority'] | LoadedFiling['authority'][] | null);
  if (!filing || !authority) return { error: 'That filing does not belong to this application’s permit type.' };

  return {
    application: {
      id: application.id,
      status: application.status,
      permit_status: application.permit_status,
      project_address: application.project_address,
      contractorCompanyName: first(application.contractors as { company_name: string } | { company_name: string }[] | null)?.company_name ?? null,
    },
    filingId: filing.id,
    permitTypeTitle: first(filing.permit_types as { title: string } | { title: string }[] | null)?.title ?? 'Permit application',
    authority,
  };
}

async function canSubmit(supabase: Client, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_submit_filings', { check_org_id: orgId });
  return !error && data === true;
}

// Moves the application to submitted on both status machines. Failures here
// don't undo the submission (it already happened) -- they come back as a
// note so the user can see why a status didn't move.
async function advanceToSubmitted(supabase: Client, loaded: LoadedFiling): Promise<string | null> {
  const notes: string[] = [];
  if (loaded.application.status === 'documents_generated') {
    const { error } = await supabase
      .from('permit_applications')
      .update({ status: 'submitted' })
      .eq('id', loaded.application.id)
      .eq('status', 'documents_generated');
    if (error) notes.push(`Application status not updated: ${error.message}`);
  }
  if (loaded.application.permit_status === 'ready_to_submit') {
    const { error } = await supabase.rpc('transition_permit_status', {
      p_application_id: loaded.application.id,
      p_to_status: 'submitted',
      p_reason: `Submitted to ${loaded.authority.name}`,
    });
    if (error) notes.push(`Permit status left at "ready to submit": ${error.message}`);
  }
  return notes.length ? notes.join(' ') : null;
}

export async function submitFilingByEmail(
  supabase: Client,
  ctx: SubmitterContext,
  applicationId: string,
  filingId: string
): Promise<SubmitResult> {
  if (!isCitySubmissionEnabled()) return { ok: false, error: 'Submitting to authorities is currently off.' };
  if (!(await canSubmit(supabase, ctx.orgId))) {
    return { ok: false, error: 'Only owners and permit managers can submit applications to an authority.' };
  }

  const loaded = await loadFiling(supabase, ctx.orgId, applicationId, filingId);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  if (loaded.authority.filing_mechanism !== 'pdf_email') {
    return { ok: false, error: `${loaded.authority.name} does not accept submissions by email.` };
  }

  const recipient = resolveSubmissionRecipient({
    authorityEmail: loaded.authority.submission_email,
    vercelEnv: process.env.VERCEL_ENV,
    overrideEmail: process.env.PERMITFIELD_SUBMISSION_EMAIL_OVERRIDE,
  });
  if (!recipient.ok) return { ok: false, error: recipient.error };

  const { data: generated, error: generatedError } = await supabase
    .from('generated_documents')
    .select('id, storage_path')
    .eq('application_id', applicationId)
    .eq('permit_type_filing_id', filingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (generatedError) return { ok: false, error: `Could not load the filled form: ${generatedError.message}` };
  if (!generated) return { ok: false, error: 'No filled form has been generated for this filing yet.' };

  const { data: pdfBlob, error: downloadError } = await supabase.storage.from(GENERATED_BUCKET).download(generated.storage_path);
  if (downloadError || !pdfBlob) return { ok: false, error: 'Could not read the filled form from storage.' };
  const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
  if (pdfBytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'The filled form is too large to email.' };

  const { data: docs, error: docsError } = await supabase
    .from('application_documents')
    .select('original_filename, storage_path, status')
    .eq('application_id', applicationId)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: true });
  if (docsError) return { ok: false, error: `Could not load the application documents: ${docsError.message}` };
  const shareable = (docs ?? []).filter((doc) => doc.status !== 'rejected');

  let documentLinks: { name: string; url: string }[] = [];
  if (shareable.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUrls(
        shareable.map((doc) => doc.storage_path),
        DOCUMENT_LINK_TTL_SECONDS
      );
    if (signError || !signed) return { ok: false, error: 'Could not create download links for the documents.' };
    documentLinks = shareable.flatMap((doc, i) => (signed[i]?.signedUrl ? [{ name: doc.original_filename, url: signed[i].signedUrl }] : []));
  }
  const linksExpireAt = new Date(Date.now() + DOCUMENT_LINK_TTL_SECONDS * 1000);

  const { data: profile } = await supabase
    .from('org_tax_profiles')
    .select('invoice_contact_email')
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  const contactEmail = profile?.invoice_contact_email || ctx.userEmail;
  if (!contactEmail) return { ok: false, error: 'Add a contact email to your organization before submitting.' };

  const content = buildSubmissionEmail({
    authorityName: loaded.authority.name,
    orgName: ctx.orgName,
    projectAddress: loaded.application.project_address,
    permitTypeTitle: loaded.permitTypeTitle,
    contractorCompanyName: loaded.application.contractorCompanyName,
    contactEmail,
    documentLinks,
    linksExpireAt,
  });

  const sent = await sendEmail({
    to: recipient.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
    fromName: `${ctx.orgName} via PermitField`,
    replyTo: contactEmail,
    cc: contactEmail,
    attachments: [{ filename: content.attachmentFilename, content: pdfBytes, contentType: 'application/pdf' }],
  });

  const { error: insertError } = await supabase.from('filing_submissions').insert({
    org_id: ctx.orgId,
    application_id: applicationId,
    permit_type_filing_id: filingId,
    authority_id: loaded.authority.id,
    method: 'email',
    status: sent.success ? 'sent' : 'failed',
    to_email: recipient.to,
    cc_email: contactEmail,
    subject: content.subject,
    generated_document_id: generated.id,
    document_links_expire_at: documentLinks.length ? linksExpireAt.toISOString() : null,
    provider_message_id: sent.success ? sent.id : null,
    error_message: sent.success ? null : sent.error,
    submitted_by: ctx.userId,
  });
  if (insertError) {
    console.error(`[submissions] filing_submissions insert failed for application ${applicationId}: ${insertError.message}`);
  }

  if (!sent.success) {
    return { ok: false, error: `The email could not be sent: ${sent.error}` };
  }

  const statusNote = await advanceToSubmitted(supabase, loaded);
  await writeAuditLog(supabase, {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    action: 'application.submitted_to_authority',
    entityType: 'permit_applications',
    entityId: applicationId,
    afterSummary: { method: 'email', authority: loaded.authority.name, to: recipient.to, overridden: recipient.overridden },
  });

  const where = recipient.overridden ? `${recipient.to} (test override -- not the authority)` : recipient.to;
  return { ok: true, message: [`Sent to ${where}. A copy went to ${contactEmail}.`, statusNote].filter(Boolean).join(' ') };
}

export async function recordFilingSubmission(
  supabase: Client,
  ctx: SubmitterContext,
  applicationId: string,
  filingId: string,
  method: 'portal' | 'in_person',
  externalReference: string | null
): Promise<SubmitResult> {
  if (!isCitySubmissionEnabled()) return { ok: false, error: 'Submitting to authorities is currently off.' };
  if (!(await canSubmit(supabase, ctx.orgId))) {
    return { ok: false, error: 'Only owners and permit managers can record a submission.' };
  }
  const reference = externalReference?.trim() || null;
  if (reference && reference.length > 200) return { ok: false, error: 'The reference must be 200 characters or fewer.' };

  const loaded = await loadFiling(supabase, ctx.orgId, applicationId, filingId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const { error: insertError } = await supabase.from('filing_submissions').insert({
    org_id: ctx.orgId,
    application_id: applicationId,
    permit_type_filing_id: filingId,
    authority_id: loaded.authority.id,
    method,
    status: 'recorded',
    external_reference: reference,
    submitted_by: ctx.userId,
  });
  if (insertError) return { ok: false, error: `Could not record the submission: ${insertError.message}` };

  const statusNote = await advanceToSubmitted(supabase, loaded);
  await writeAuditLog(supabase, {
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    action: 'application.submitted_to_authority',
    entityType: 'permit_applications',
    entityId: applicationId,
    afterSummary: { method, authority: loaded.authority.name, reference },
  });

  return { ok: true, message: [`Recorded your ${method === 'portal' ? 'portal' : 'in-person'} submission to ${loaded.authority.name}.`, statusNote].filter(Boolean).join(' ') };
}
