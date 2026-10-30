'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { inngest } from '@/lib/inngest/client';
import { createClient } from '@/lib/supabase/server';

// Source registry console (Gate 6.3). Every action re-runs requireAdmin()
// (ADMIN_EMAILS allowlist) and checks the flag. Writes go through the
// signed-in admin's OWN session, not the service client, so the database
// functions' is_platform_admin() check applies as a second, independent
// gate and the actor recorded is always auth.uid() -- never a form value.

export interface SourceActionState {
  error?: string;
  message?: string;
}

async function gate() {
  const admin = await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();
  return admin;
}

function refresh(sourceId?: string) {
  revalidatePath('/admin/sources');
  if (sourceId) revalidatePath(`/admin/sources/${sourceId}`);
}

function dbError(message: string, code: string | undefined): string {
  if (code === '42501') {
    return 'The database does not recognise your account as a platform admin, so nothing was saved.';
  }
  return message;
}

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.iso.date().nullable());

const PublishCaptureSchema = z
  .object({
    sourceId: z.guid(),
    captureId: z.guid(),
    title: z.string().trim().min(1, 'Title is required.').max(300),
    issuingBody: z.string().trim().min(1, 'Issuing body is required.').max(300),
    publishedOn: optionalDate,
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
    accessScope: z.enum(['public', 'public_no_redistribution', 'licensed_internal']),
    licenceNotes: z.string().trim().max(2000),
    notes: z.string().trim().max(2000),
  })
  .refine((v) => !v.effectiveFrom || !v.effectiveTo || v.effectiveFrom <= v.effectiveTo, {
    message: 'Effective from must be on or before effective to.',
  });

const formValue = (formData: FormData, key: string) => String(formData.get(key) ?? '');

const RevisionDetailsSchema = z
  .object({
    sourceId: z.guid(),
    revisionId: z.guid(),
    title: z.string().trim().min(1, 'Title is required.').max(300),
    issuingBody: z.string().trim().min(1, 'Issuing body is required.').max(300),
    publishedOn: optionalDate,
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
    accessScope: z.enum(['public', 'public_no_redistribution', 'licensed_internal']),
    licenceNotes: z.string().trim().max(2000),
    notes: z.string().trim().min(1, 'Say what you are correcting.').max(1900),
  })
  .refine((v) => !v.effectiveFrom || !v.effectiveTo || v.effectiveFrom <= v.effectiveTo, {
    message: 'Effective from must be on or before effective to.',
  });

export async function checkSourceNowAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  const admin = await gate();
  const sourceId = z.guid().safeParse(formValue(formData, 'sourceId'));
  if (!sourceId.success) return { error: 'Invalid source.' };
  await inngest.send({
    name: 'source/check.requested',
    data: { sourceId: sourceId.data, requestKey: randomUUID(), requestedBy: admin.id },
  });
  refresh(sourceId.data);
  return { message: 'Check requested. Refresh in a minute to see the result.' };
}

export async function publishCaptureAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  await gate();
  const parsed = PublishCaptureSchema.safeParse({
    sourceId: formValue(formData, 'sourceId'),
    captureId: formValue(formData, 'captureId'),
    title: formValue(formData, 'title'),
    issuingBody: formValue(formData, 'issuingBody'),
    publishedOn: formValue(formData, 'publishedOn'),
    effectiveFrom: formValue(formData, 'effectiveFrom'),
    effectiveTo: formValue(formData, 'effectiveTo'),
    accessScope: formValue(formData, 'accessScope'),
    licenceNotes: formValue(formData, 'licenceNotes'),
    notes: formValue(formData, 'notes'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_source_revision', {
    p_capture_id: v.captureId,
    p_title: v.title,
    p_issuing_body: v.issuingBody,
    p_published_on: v.publishedOn,
    p_effective_from: v.effectiveFrom,
    p_effective_to: v.effectiveTo,
    p_access_scope: v.accessScope,
    p_licence_notes: v.licenceNotes || null,
    p_notes: v.notes || null,
  });
  if (error) return { error: `Not published: ${dbError(error.message, error.code)}` };
  refresh(v.sourceId);
  return { message: 'Published as a new revision.' };
}

export async function dismissCaptureAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  await gate();
  const parsed = z
    .object({ sourceId: z.guid(), captureId: z.guid(), notes: z.string().trim().min(1, 'Say why it is dismissed.').max(2000) })
    .safeParse({ sourceId: formValue(formData, 'sourceId'), captureId: formValue(formData, 'captureId'), notes: formValue(formData, 'notes') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('dismiss_source_capture', { p_capture_id: parsed.data.captureId, p_notes: parsed.data.notes });
  if (error) return { error: `Not dismissed: ${dbError(error.message, error.code)}` };
  refresh(parsed.data.sourceId);
  return { message: 'Dismissed.' };
}

// Corrects the newest published revision's details (migration
// 20260806000103): a new revision with the same captured text and the
// corrected details; the original stays in the ledger.
export async function correctRevisionAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  await gate();
  const parsed = RevisionDetailsSchema.safeParse({
    sourceId: formValue(formData, 'sourceId'),
    revisionId: formValue(formData, 'revisionId'),
    title: formValue(formData, 'title'),
    issuingBody: formValue(formData, 'issuingBody'),
    publishedOn: formValue(formData, 'publishedOn'),
    effectiveFrom: formValue(formData, 'effectiveFrom'),
    effectiveTo: formValue(formData, 'effectiveTo'),
    accessScope: formValue(formData, 'accessScope'),
    licenceNotes: formValue(formData, 'licenceNotes'),
    notes: formValue(formData, 'notes'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('correct_source_revision', {
    p_revision_id: v.revisionId,
    p_title: v.title,
    p_issuing_body: v.issuingBody,
    p_published_on: v.publishedOn,
    p_effective_from: v.effectiveFrom,
    p_effective_to: v.effectiveTo,
    p_access_scope: v.accessScope,
    p_licence_notes: v.licenceNotes || null,
    p_notes: v.notes,
  });
  if (error) return { error: `Not corrected: ${dbError(error.message, error.code)}` };
  refresh(v.sourceId);
  return { message: 'Corrected. The new revision replaces it as evidence.' };
}

// Withdrawing appends a 'disputed' review; the revision stops being
// searchable at once and nothing older takes its place.
export async function withdrawRevisionAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  const admin = await gate();
  const parsed = z
    .object({ sourceId: z.guid(), revisionId: z.guid(), notes: z.string().trim().min(1, 'Say why it is withdrawn.').max(2000) })
    .safeParse({ sourceId: formValue(formData, 'sourceId'), revisionId: formValue(formData, 'revisionId'), notes: formValue(formData, 'notes') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('source_revision_reviews')
    .insert({ source_revision_id: parsed.data.revisionId, status: 'disputed', notes: parsed.data.notes, reviewed_by: admin.id });
  if (error) return { error: `Not withdrawn: ${dbError(error.message, error.code)}` };
  refresh(parsed.data.sourceId);
  return { message: 'Withdrawn. It is no longer used as evidence.' };
}
