import type { PermitEventPayloads } from '@/lib/inngest/client';

// Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K). Pure, model-free,
// deterministic mapping from one of the four target lifecycle events to
// notifiable content -- or `null` when that specific occurrence is not
// worth notifying about. Exported (not just used locally by notify.ts) so
// eval/run.ts's offline checks can exercise this exact function directly,
// same "pure decision logic gets its own fixture-driven offline coverage"
// pattern as computeMissingDocumentFindings (lib/inngest/functions/
// audit.ts) and validateDrawingFindingItem (lib/ai/review-drawing.ts).
//
// DELIBERATE SKIPS (return null): `permit/application.audited` with
// `audited: false`, and `permit/application.drawing_reviewed` with
// `reviewed: false`. Both mean "no result exists yet" (flag off, or the
// jurisdiction's coverage_level isn't 'verified') -- an honest non-event,
// not a failure, mirroring those functions' own "no row exists yet is the
// honest signal" doctrine (see audit.ts/drawing-review.ts header
// comments). Notifying about a deliberate skip would either be noise on
// every un-covered jurisdiction, or -- worse -- read as "something went
// wrong" when nothing did. This is asymmetric with the other two failure
// paths this module DOES notify on (extraction validation failure, PDF
// generation failure): those are genuine, actionable problems with a real
// attempt that ran and failed, not a gate that declined to run at all.

export type NotificationTargetEventName =
  | 'permit/application.extracted'
  | 'permit/application.audited'
  | 'permit/application.pdf_generated'
  | 'permit/application.drawing_reviewed';

export type NotificationTargetEventData =
  | PermitEventPayloads['permit/application.extracted']
  | PermitEventPayloads['permit/application.audited']
  | PermitEventPayloads['permit/application.pdf_generated']
  | PermitEventPayloads['permit/application.drawing_reviewed'];

export type NotificationEventKind =
  | 'extraction_completed'
  | 'extraction_failed'
  | 'audit_completed'
  | 'pdf_generated'
  | 'pdf_generation_failed'
  | 'drawing_review_completed';

export interface NotificationContentContext {
  permitTypeTitle: string;
}

export interface DerivedNotificationContent {
  eventKind: NotificationEventKind;
  subject: string;
  text: string;
  // Only populated for 'drawing_review_completed' -- a drawing review is
  // scoped to one application_documents row, not the whole application
  // (mirrors drawing_reviews.application_document_id, 20260806000044). Every
  // other event kind here is application-scoped, so this is null for them.
  applicationDocumentId: string | null;
}

export interface DigestEmailItem {
  subject: string;
  text: string;
}

export interface ComposedDigestEmail {
  subject: string;
  text: string;
}

// Gate 5, sub-phase 5.3 hardening (digest/batching). Pure, deterministic,
// same offline-testable discipline as deriveNotificationContent() above --
// combines N already-derived DerivedNotificationContent items (read back
// from notification_pending_events by lib/inngest/functions/notify.ts's
// permitNotifyFlush) into ONE email's subject/body. Takes the plain
// {subject, text} shape rather than DerivedNotificationContent itself: this
// function has no need for (and shouldn't have to fabricate) eventKind/
// applicationDocumentId once the individual pieces are already being
// combined into one email -- notification_log still gets one row per
// original item, but that bookkeeping happens at the call site using the
// pending rows' own already-known eventKind, not through this function.
//
// `items` is assumed non-empty (permitNotifyFlush never calls this for a
// zero-pending-row flush -- there is nothing to send in that case, not an
// empty digest) -- callers already gate on that, so this throws rather than
// silently returning a blank email a caller bug could ship.
export function composeDigestEmail(items: DigestEmailItem[]): ComposedDigestEmail {
  if (items.length === 0) {
    throw new Error('composeDigestEmail requires at least one item.');
  }

  // Single item: no digest framing needed at all -- the exact same email a
  // non-digested send would have produced, so a quiet application (one
  // event, nothing else queued behind it within the debounce window) reads
  // identically to how this notification looked before batching existed.
  if (items.length === 1) {
    return { subject: items[0].subject, text: items[0].text };
  }

  return {
    subject: `${items.length} updates: ${items[0].subject}`,
    text: items.map((item, index) => `${index + 1}. ${item.subject}\n${item.text}`).join('\n\n'),
  };
}

export function deriveNotificationContent(
  eventName: NotificationTargetEventName,
  eventData: NotificationTargetEventData,
  context: NotificationContentContext
): DerivedNotificationContent | null {
  switch (eventName) {
    case 'permit/application.extracted': {
      const data = eventData as PermitEventPayloads['permit/application.extracted'];
      if (data.zodValid) {
        return {
          eventKind: 'extraction_completed',
          subject: `Extraction complete: ${context.permitTypeTitle}`,
          text: `Document extraction has finished for your ${context.permitTypeTitle} application.`,
          applicationDocumentId: null,
        };
      }
      return {
        eventKind: 'extraction_failed',
        subject: `Action needed: extraction failed for ${context.permitTypeTitle}`,
        text: `Document extraction failed validation for your ${context.permitTypeTitle} application and needs attention.`,
        applicationDocumentId: null,
      };
    }
    case 'permit/application.audited': {
      const data = eventData as PermitEventPayloads['permit/application.audited'];
      if (!data.audited) {
        return null;
      }
      return {
        eventKind: 'audit_completed',
        subject: `Audit complete: ${context.permitTypeTitle}`,
        text: `Your ${context.permitTypeTitle} application has been audited against jurisdiction code.`,
        applicationDocumentId: null,
      };
    }
    case 'permit/application.pdf_generated': {
      const data = eventData as PermitEventPayloads['permit/application.pdf_generated'];
      if (data.succeeded) {
        return {
          eventKind: 'pdf_generated',
          subject: `Documents ready: ${context.permitTypeTitle}`,
          text: `Your permit documents are ready for your ${context.permitTypeTitle} application (${data.generatedDocumentIds.length} file(s)).`,
          applicationDocumentId: null,
        };
      }
      return {
        eventKind: 'pdf_generation_failed',
        subject: `Action needed: document generation failed for ${context.permitTypeTitle}`,
        text: `Document generation failed for your ${context.permitTypeTitle} application and needs attention.`,
        applicationDocumentId: null,
      };
    }
    case 'permit/application.drawing_reviewed': {
      const data = eventData as PermitEventPayloads['permit/application.drawing_reviewed'];
      if (!data.reviewed) {
        return null;
      }
      return {
        eventKind: 'drawing_review_completed',
        subject: `Drawing review complete: ${context.permitTypeTitle}`,
        text: `A drawing review has finished for your ${context.permitTypeTitle} application.`,
        applicationDocumentId: data.applicationDocumentId,
      };
    }
  }
}
