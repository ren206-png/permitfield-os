import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isFailureNotificationsEnabled } from '@/lib/flags';
import { writeNotification, type NotificationKind } from '@/lib/notifications/write';
import { sendFailureEmail } from '@/lib/email/resend-client';

// permit.notify_on_failure: the "Phase 5 UI/notifications" consumer that
// lib/inngest/client.ts's PermitEventPayloads has named, in each of these
// three events' own header comments, as the intended-but-not-yet-built
// reader of their failure signal. Nothing about the upstream events changes
// here -- extract.ts/audit.ts/generate-pdf.ts already emit
// 'permit/application.extracted'/'.audited'/'.pdf_generated' unconditionally
// on both success and failure, exactly as before; this function is a new,
// purely additive subscriber (PERMITFIELD_FF_FAILURE_NOTIFICATIONS, see
// lib/flags.ts's isFailureNotificationsEnabled() header comment).
//
// Writes an in-app notifications row (20260806000044_notifications.sql) and
// sends one email per genuine failure. Both are best-effort: neither
// writeNotification() nor sendFailureEmail() throws (same "write a ledger
// row, never throw" discipline as lib/audit/log.ts's writeAuditLog()) --
// this function's own job is describing a failure that already happened
// elsewhere, so a notification-delivery problem must never itself surface
// as a retriable Inngest failure that keeps re-running an already-complete
// pipeline step.
//
// idempotency keyed on applicationId + event.name, same reasoning as
// generate-pdf.ts's own header comment: this function has three distinct
// triggers, and Inngest's `idempotency` dedups per-FUNCTION across ALL
// triggers -- a bare applicationId key would collapse two different
// triggering events for the same application into one slot.
export const notifyOnFailure = inngest.createFunction(
  {
    id: 'permit-notify-on-failure',
    name: 'Notify org on pipeline failure',
    triggers: [
      { event: 'permit/application.extracted' },
      { event: 'permit/application.audited' },
      { event: 'permit/application.pdf_generated' },
    ],
    idempotency: 'event.data.applicationId + "-" + event.name',
    retries: 2,
  },
  async ({ event, step }) => {
    // Checked first, before any DB read -- an environment with the flag off
    // does zero extra work per pipeline event, matching every other flag in
    // this file's "off means byte-identical to before this build" rule.
    if (!isFailureNotificationsEnabled()) {
      return { notified: false, reason: 'flag_off' as const };
    }

    const { applicationId } = event.data as { applicationId: string };
    const supabase = createServiceClient();

    const application = await step.run('load-application', async () => {
      const { data, error } = await supabase
        .from('permit_applications')
        .select('org_id, project_title, status')
        .eq('id', applicationId)
        .single();
      if (error || !data) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${error?.message ?? 'no row'}`);
      }
      return {
        orgId: data.org_id as string,
        projectTitle: data.project_title as string,
        status: data.status as string,
      };
    });

    const classification = classifyFailure(
      event.name as keyof PermitEventPayloads,
      event.data as PermitEventPayloads[keyof PermitEventPayloads],
      application.status
    );

    if (!classification) {
      return { applicationId, notified: false, reason: 'not_a_failure' as const };
    }

    const message = `${application.projectTitle}: ${classification.message}`;

    await step.run('write-notification-row', async () => {
      const { error } = await writeNotification(supabase, {
        orgId: application.orgId,
        applicationId,
        kind: classification.kind,
        message,
      });
      if (error) {
        // Logged, not thrown -- see this function's header comment. A
        // console.error here is this repo's existing floor for
        // non-throwing-helper failures (no structured logging pipeline
        // exists yet anywhere in this codebase).
        console.error(`writeNotification failed for application ${applicationId}: ${error}`);
      }
    });

    const recipients = await step.run('load-recipients', async () => {
      return loadNotifiedRecipientEmails(supabase, application.orgId);
    });

    await step.run('send-email', async () => {
      const { error } = await sendFailureEmail({
        to: recipients,
        subject: `Action needed: ${application.projectTitle}`,
        text: message,
      });
      if (error) {
        console.error(`sendFailureEmail failed for application ${applicationId}: ${error}`);
      }
    });

    return { applicationId, notified: true, kind: classification.kind, recipientCount: recipients.length };
  }
);

export interface FailureClassification {
  kind: NotificationKind;
  message: string;
}

// Roles notified for a pipeline failure -- the same 7-role "org's own
// day-to-day permitting work" set as lib/permit-status/transitions.ts's
// ORG_TIER_ROLES / docs/STATUS_TRANSITIONS.md's org tier /
// transition_permit_status()'s Check 2 org-tier branch
// (20260806000045_permit_status_org_tier_role_gap.sql). Reused here as a
// judgment call, not a spec citation (flagged per this repo's established
// "flag judgment calls" discipline, e.g. 20260806000025's own header): a
// stalled pipeline is exactly the kind of thing the org's day-to-day
// permitting roles need to act on, while document_reviewer/client_user/
// auditor_readonly's narrower, already-established scope (lib/authz/
// index.ts's own per-role reasoning) doesn't include acting on it.
const NOTIFIED_ROLES = [
  'owner',
  'org_owner',
  'platform_admin',
  'member',
  'permit_manager',
  'permit_coordinator',
  'applicant_contractor',
] as const;

// Pure, DB-I/O-free classification of one incoming event into a
// notification (or null, meaning "not a failure -- no notification").
// Exported so a plain vitest file can exercise every branch without
// spinning up Inngest or a DB -- this repo has no @inngest/test/
// inngest-testing convention yet, same reason lib/inngest/functions/
// audit.ts exports computeMissingDocumentFindings as a standalone pure
// function instead.
//
// `liveApplicationStatus` matters for the 'audited' and 'pdf_generated'
// events, both of which are overloaded the same way:
//   - audit.ts emits audited:false from THREE call sites -- a genuine
//     model/audit failure (status set to 'audit_failed'), extraction having
//     already failed (status left at 'extraction_failed', already notified
//     by the 'extracted' branch below -- notifying again here would be a
//     duplicate for the same root cause), and a deliberate, benign skip
//     (PERMITFIELD_FF_AI_AUDIT off, or a non-'verified' coverage tier;
//     status left unchanged, never a failure at all). Only the first is
//     real.
//   - generate-pdf.ts emits succeeded:false from TWO call sites -- a
//     genuine generation failure (status set to 'document_generation_failed')
//     and a deliberate "not eligible yet" skip (e.g. a 'verified'-tier
//     application's 'audited' trigger firing before review-confirmation;
//     status left unchanged) that fires on every single audited event for
//     that tier, not just failures.
// Trusting the event payload's boolean alone would therefore false-positive
// on every benign skip. The live status is re-derived from the DB by this
// function's only caller (never read off the event payload), matching
// generate-pdf.ts's own "never trust the event payload, re-check live"
// discipline.
export function classifyFailure(
  eventName: keyof PermitEventPayloads,
  eventData: PermitEventPayloads[keyof PermitEventPayloads],
  liveApplicationStatus: string | null
): FailureClassification | null {
  if (eventName === 'permit/application.extracted') {
    const data = eventData as PermitEventPayloads['permit/application.extracted'];
    if (data.zodValid) return null;
    return {
      kind: 'extraction_failed',
      message: 'Document extraction failed and could not be validated. Review the uploaded documents and retry.',
    };
  }

  if (eventName === 'permit/application.audited') {
    const data = eventData as PermitEventPayloads['permit/application.audited'];
    if (data.audited) return null;
    if (liveApplicationStatus !== 'audit_failed') return null;
    return {
      kind: 'audit_failed',
      message: 'The compliance audit failed and produced no results. Review the application and retry.',
    };
  }

  if (eventName === 'permit/application.pdf_generated') {
    const data = eventData as PermitEventPayloads['permit/application.pdf_generated'];
    if (data.succeeded) return null;
    if (liveApplicationStatus !== 'document_generation_failed') return null;
    return {
      kind: 'document_generation_failed',
      message: 'Permit document generation failed -- no filled PDF was produced for this application.',
    };
  }

  return null;
}

// Small, bounded per-org fan-out (an org's member count, not a platform-wide
// scan) -- deliberately getUserById() per member rather than
// listUsers()-and-filter (app/admin/page.tsx's own pattern), since that
// helper's whole reason to paginate is a platform-wide, unbounded user list;
// here the candidate set is already narrowed to one org's own
// NOTIFIED_ROLES members via org_members, typically a handful of rows.
async function loadNotifiedRecipientEmails(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string
): Promise<string[]> {
  const { data: members, error } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .in('role', NOTIFIED_ROLES);
  if (error) {
    throw new Error(`Failed to load org_members for ${orgId}: ${error.message}`);
  }

  const emails = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data, error: userError } = await supabase.auth.admin.getUserById(m.user_id as string);
      if (userError || !data?.user?.email) return null;
      return data.user.email;
    })
  );

  return emails.filter((e): e is string => e !== null);
}
