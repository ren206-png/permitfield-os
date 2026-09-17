import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isNotificationsEnabled } from '@/lib/flags';
import { SITE_URL } from '@/lib/seo';
import {
  composeDigestEmail,
  deriveNotificationContent,
  type NotificationTargetEventData,
  type NotificationTargetEventName,
} from '@/lib/notifications/content';
import { resolveOrgNotificationRecipients } from '@/lib/notifications/recipients';
import { sendNotificationEmail } from '@/lib/notifications/send';

// Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K/§F/§J.4). permit.notify:
// the first real subscriber to four events that were, until now, each
// explicitly documented in lib/inngest/client.ts as having "no subscriber
// exists yet... Phase 5's UI/notifications are the intended future
// consumer." Fans in from all four -- 'permit/application.extracted' /
// '.audited' / '.pdf_generated' / '.drawing_reviewed' -- rather than one
// function per event, mirroring generate-pdf.ts's own proven precedent of
// one function subscribing to more than one named event.
//
// HARDENED (post-ship, per Ren's explicit "1-4 matters to me please work on
// it" instruction) into a two-function record+debounced-flush split:
//
//   permitNotify (this function): derives notification content exactly as
//   the original single-function version did, but no longer sends an email
//   itself -- it records the content (deep link already appended, see
//   below) into the new notification_pending_events queue table and emits
//   an internal 'permit/notification.queued' event to (re)start a debounce
//   window for this application.
//
//   permitNotifyFlush (below, in this same file -- generate-pdf.ts's own
//   precedent of one file hosting more than one exported
//   inngest.createFunction() when they're this tightly coupled): the sole
//   subscriber to 'permit/notification.queued', debounced on applicationId
//   so a rapid-fire burst of lifecycle events for the same application
//   (e.g. extracted -> audited -> pdf_generated, each firing within
//   seconds/minutes of the last during one pipeline run) collapses into ONE
//   delayed run that reads every still-pending row for that application and
//   sends ONE combined digest email per recipient, instead of one email per
//   event.
//
// WHY SPLIT AT ALL, RATHER THAN JUST ADDING `debounce` TO THIS FUNCTION
// DIRECTLY: Inngest's debounce replaces the eventually-executed run's
// triggering event with only the LATEST matching event received --
// confirmed via node_modules/inngest/components/InngestFunction.d.ts's own
// doc comment ("the triggering event is replaced with the latest event
// received"). Debouncing THIS function directly (which has four different
// trigger event names) would silently drop every earlier event's own data
// the moment a second one arrived within the debounce window -- exactly the
// data loss this hardening pass exists to prevent. See
// 20260806000049_notification_pending_events.sql's header comment for the
// full reasoning, including why Inngest's native `batchEvents` was also
// considered and rejected (unconfirmed cross-trigger-name behavior, and
// documented incompatibility with idempotency/rateLimit/cancel/priority).
//
// NO function-level `idempotency` key on EITHER function below --
// deliberately, unlike every other function in this file's sibling
// modules. Inngest's idempotency expression language (confirmed via its own
// docs: dot-path field access into event.data, plus `+` string
// concatenation -- no confirmed support for conditional/OR logic, and no
// confirmed access to event.name) can only safely express a SINGLE key
// strategy applied uniformly regardless of which of the four trigger events
// fired. This function's four events don't share one field that is both
// non-null and non-colliding across all of them:
//   - applicationId alone collides ACROSS event types for the same
//     application (this function would then treat the second, third,
//     and fourth distinct lifecycle event for one application as a
//     "duplicate" of the first and silently drop them).
//   - extractionId/auditId/generatedDocumentIds are each present on
//     only one event type and null/absent/empty on others.
// Real duplicate-send protection instead comes from several places, none of
// which need a top-level idempotency key:
//   (1) each upstream emitter's own step.sendEvent() call is now given a
//       deterministic `id` (see extract.ts/audit.ts/generate-pdf.ts/
//       drawing-review.ts's own sendEvent comments) -- Inngest dedupes
//       event INGESTION by id, so a re-send of an event permitNotify has
//       already seen is dropped before permitNotify ever runs again for it.
//   (2) permitNotify's own step.run('enqueue-pending-event') is memoized --
//       a retry of permitNotify's run replays that memoized insert rather
//       than inserting a second pending row.
//   (3) permitNotifyFlush's own `concurrency: { limit: 1, key:
//       'event.data.applicationId' }` ensures at most one flush run per
//       application executes at a time, so two nearly-simultaneous flush
//       triggers for the same application can never both read the same
//       still-unflushed rows and double-send -- the second run always sees
//       whatever the first run already marked `flushed_at` on.
//   (4) permitNotifyFlush's own per-recipient step.run() (send) plus
//       per-(recipient, pending item) step.run() (log) means a retry of
//       THIS function replays already-sent recipients from their memoized
//       result rather than re-sending to them.
export const permitNotify = inngest.createFunction(
  {
    id: 'permit-notify',
    name: 'Record org-member notification content for application lifecycle events',
    triggers: [
      { event: 'permit/application.extracted' },
      { event: 'permit/application.audited' },
      { event: 'permit/application.pdf_generated' },
      { event: 'permit/application.drawing_reviewed' },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    const eventName = event.name as NotificationTargetEventName;
    const eventData = event.data as NotificationTargetEventData;
    const { applicationId } = eventData;
    const supabase = createServiceClient();

    const context = await step.run('load-context', async () => {
      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, org_id, permit_type_id')
        .eq('id', applicationId)
        .single();
      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: permitType, error: permitTypeError } = await supabase
        .from('permit_types')
        .select('title')
        .eq('id', application.permit_type_id)
        .single();
      if (permitTypeError || !permitType) {
        throw new Error(
          `permit_types row not found for ${application.permit_type_id}: ${permitTypeError?.message ?? 'no row'}`
        );
      }

      return {
        orgId: application.org_id as string,
        permitTypeTitle: permitType.title as string,
      };
    });

    // Ops-level kill switch (lib/flags.ts's isNotificationsEnabled) -- same
    // "checked before any external side effect" placement as every other
    // flag gate in this codebase. When gated off, nothing is inserted into
    // notification_pending_events at all -- consistent with this codebase's
    // "no row exists yet is the honest signal" doctrine, not a row claiming
    // a notification that was never actually queued.
    if (!isNotificationsEnabled()) {
      return { applicationId, queued: false, skipped: 'flag_off' as const };
    }

    // Pure, deterministic, model-free (see lib/notifications/content.ts's
    // own header for the full skip-vs-failure reasoning). `null` means this
    // specific occurrence is a deliberate skip (e.g. audited=false), not
    // something to notify about.
    const content = deriveNotificationContent(eventName, eventData, {
      permitTypeTitle: context.permitTypeTitle,
    });
    if (!content) {
      return { applicationId, queued: false, skipped: 'not_actionable' as const };
    }

    // Deep link, constructed here (not inside deriveNotificationContent) --
    // that function stays free of env-var/URL-construction logic on
    // purpose, so it stays offline-testable via eval/run.ts without needing
    // NEXT_PUBLIC_SITE_URL configured. This is the same route shape
    // app/(app)/applications/[id]/page.tsx already serves.
    const deepLink = `${SITE_URL}/applications/${applicationId}`;
    const body = `${content.text}\n\nView application: ${deepLink}`;

    // One row recorded per real occurrence, immediately -- never lost to
    // permitNotifyFlush's own debounce window "only the latest event
    // survives" limitation (see this file's header comment and
    // 20260806000049_notification_pending_events.sql's header for why).
    const enqueued = await step.run('enqueue-pending-event', async () => {
      const { data: inserted, error } = await supabase
        .from('notification_pending_events')
        .insert({
          org_id: context.orgId,
          application_id: applicationId,
          application_document_id: content.applicationDocumentId,
          event_kind: content.eventKind,
          subject: content.subject,
          body,
        })
        .select('id')
        .single();
      if (error || !inserted) {
        throw new Error(`Failed to insert notification_pending_events row: ${error?.message ?? 'no row returned'}`);
      }
      return { pendingEventId: inserted.id as string };
    });

    await step.sendEvent('emit-notification-queued', {
      // Deterministic id, keyed on the freshly-inserted pending row's own
      // id -- guaranteed fresh per real occurrence (a genuine retry of
      // THIS run replays the memoized enqueue-pending-event result above
      // rather than inserting a second row, so this id is stable across
      // retries of one real occurrence too). See this file's header comment
      // point (1) for why a deterministic id matters here at all.
      id: `permit/notification.queued:${enqueued.pendingEventId}`,
      name: 'permit/notification.queued',
      data: { applicationId } satisfies PermitEventPayloads['permit/notification.queued'],
    });

    return { applicationId, queued: true, pendingEventId: enqueued.pendingEventId };
  }
);

// permitNotifyFlush: the sole subscriber to 'permit/notification.queued'.
// See this file's header comment for the full record+debounced-flush design
// this function is one half of.
//
// debounce.period = '2m': a burst of lifecycle events for the same
// application during one pipeline run (extraction, then audit, then PDF
// generation -- each involving a real model call, typically tens of seconds
// apart) is expected to finish arriving within a couple of minutes; this
// window is long enough to catch that whole burst as one digest without
// making a genuinely isolated single event wait an unreasonably long time
// to be delivered. debounce.timeout = '15m': the hard cap Inngest's own
// debounce config supports for "events keep continually arriving" -- an
// application with an unusually long, drawn-out lifecycle still gets at
// least one flush every 15 minutes rather than being deferred indefinitely.
export const permitNotifyFlush = inngest.createFunction(
  {
    id: 'permit-notify-flush',
    name: 'Send digested notification emails for an application after a quiet period',
    triggers: [{ event: 'permit/notification.queued' }],
    debounce: { key: 'event.data.applicationId', period: '2m', timeout: '15m' },
    // See this file's header comment, point (3): this is what actually
    // prevents two near-simultaneous flush triggers for the same
    // application from both reading the same still-unflushed rows and
    // double-sending -- NOT the debounce config above, which only collapses
    // how many times this function is *scheduled*, not how many times it
    // could otherwise run concurrently for the same key.
    concurrency: { limit: 1, key: 'event.data.applicationId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { applicationId } = event.data as PermitEventPayloads['permit/notification.queued'];
    const supabase = createServiceClient();

    // Never read from `event.data` beyond applicationId -- debounce's own
    // "triggering event replaced with the latest received" behavior means
    // this event's data cannot be trusted to represent every occurrence
    // that queued during the debounce window (see this file's header
    // comment). The pending-events table, not this event, is the source of
    // truth for what actually needs to be sent.
    const pending = await step.run('load-pending-events', async () => {
      const { data, error } = await supabase
        .from('notification_pending_events')
        .select('id, org_id, application_document_id, event_kind, subject, body')
        .eq('application_id', applicationId)
        .is('flushed_at', null)
        .order('created_at', { ascending: true });
      if (error) {
        throw new Error(`Failed to load notification_pending_events for ${applicationId}: ${error.message}`);
      }
      return data ?? [];
    });

    // Legitimately possible, not a bug: a prior run (see this file's header
    // comment, point (3)) already flushed every row this trigger was
    // meant to cover, e.g. two 'permit/notification.queued' events for the
    // same applicationId both survived Inngest's own event-ingestion dedup
    // (different pending-event ids, by design -- see permitNotify's own
    // sendEvent comment) but the concurrency=1 queue meant this run started
    // only after the other had already fully flushed everything pending at
    // the time.
    if (pending.length === 0) {
      return { applicationId, sent: 0, digestedEvents: 0, skipped: 'no_pending' as const };
    }

    const orgId = pending[0].org_id as string;
    const pendingIds = pending.map((item) => item.id as string);

    const recipients = await step.run('resolve-recipients', async () => resolveOrgNotificationRecipients(supabase, orgId));

    if (recipients.length === 0) {
      // Still marked flushed -- otherwise these rows would sit forever
      // (re-triggering "no recipients" on every subsequent debounce fire
      // for this application would just repeat this same no-op check
      // without ever clearing them), mirroring the original single-function
      // version's "flag_off / not_actionable means nothing is written, but
      // a real decision has still been reached" posture.
      await step.run('mark-flushed-no-recipients', async () => {
        const { error } = await supabase
          .from('notification_pending_events')
          .update({ flushed_at: new Date().toISOString() })
          .in('id', pendingIds);
        if (error) {
          throw new Error(`Failed to mark notification_pending_events flushed for ${applicationId}: ${error.message}`);
        }
      });
      return { applicationId, sent: 0, digestedEvents: pending.length, skipped: 'no_recipients' as const };
    }

    // Pure, deterministic, offline-testable (eval/run.ts) -- one combined
    // email body/subject for every recipient, computed once, not
    // recomputed per recipient.
    const digest = composeDigestEmail(pending.map((item) => ({ subject: item.subject, text: item.body })));

    // Two step.run() calls per recipient, not one, and NOT one step.run()
    // per (recipient, pending item) either -- deliberately. The actual
    // email send happens exactly once per recipient (that is the entire
    // point of digesting: recipients.length emails sent, not
    // recipients.length * pending.length), memoized so a retry never
    // re-sends to a recipient who already succeeded. The notification_log
    // row-per-original-event granularity notify.ts always had is preserved
    // by a SEPARATE step.run() per (recipient, pending item) immediately
    // after, which reads the send step's own memoized result -- a retry
    // after a partial logging failure replays the (already-memoized) send
    // step without re-sending, then only re-attempts whichever log inserts
    // hadn't yet succeeded.
    let sentCount = 0;
    for (const recipient of recipients) {
      const sendResult = await step.run(`send-digest-${recipient.userId}`, async () => {
        let status: 'sent' | 'failed' = 'sent';
        let providerMessageId: string | null = null;
        let errorMessage: string | null = null;
        try {
          const result = await sendNotificationEmail({
            to: recipient.email,
            subject: digest.subject,
            text: digest.text,
          });
          providerMessageId = result.providerMessageId;
        } catch (sendError) {
          status = 'failed';
          errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
        }
        return { status, providerMessageId, errorMessage };
      });
      if (sendResult.status === 'sent') {
        sentCount += 1;
      }

      for (const item of pending) {
        await step.run(`log-${recipient.userId}-${item.id}`, async () => {
          const { error: logError } = await supabase.from('notification_log').insert({
            org_id: orgId,
            application_id: applicationId,
            application_document_id: item.application_document_id,
            event_kind: item.event_kind,
            recipient_user_id: recipient.userId,
            recipient_email: recipient.email,
            status: sendResult.status,
            provider_message_id: sendResult.providerMessageId,
            error_message: sendResult.errorMessage,
          });
          if (logError) {
            throw new Error(`Failed to insert notification_log row: ${logError.message}`);
          }
        });
      }
    }

    await step.run('mark-flushed', async () => {
      const { error } = await supabase
        .from('notification_pending_events')
        .update({ flushed_at: new Date().toISOString() })
        .in('id', pendingIds);
      if (error) {
        throw new Error(`Failed to mark notification_pending_events flushed for ${applicationId}: ${error.message}`);
      }
    });

    return { applicationId, sent: sentCount, digestedEvents: pending.length, skipped: null };
  }
);
