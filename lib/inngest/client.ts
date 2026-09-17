import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'permitfield-os' });

// Event name + payload catalog -- documented here rather than wired into
// Inngest's generic client typing (this installed version, inngest@4.16,
// dropped the EventSchemas builder that older docs/examples show; there is
// no compile-time event-payload checking available from the client itself
// in this version). Call sites still get type safety by importing
// `PermitEventPayloads` and annotating their `inngest.send()` calls by hand
// -- see lib/inngest/functions/extract.ts and app/api/documents/route.ts.
export interface PermitEventPayloads {
  // Emitted once an application's documents are uploaded and ready for
  // extraction (app/api/documents/route.ts, on the upload that completes the
  // set -- or, until Phase 5's wizard exists, sent manually/by a test
  // fixture). Triggers lib/inngest/functions/extract.ts.
  'permit/application.documents_ready': { applicationId: string };
  // Emitted after permit.extract persists an extractions row, success or
  // failure. Phase 3's audit function (lib/inngest/functions/audit.ts) is
  // the subscriber to the success case.
  'permit/application.extracted': {
    applicationId: string;
    extractionId: string;
    zodValid: boolean;
  };
  // Emitted after permit.audit finishes, including the "skipped" case (AI
  // audit disabled by flag, or the jurisdiction's coverage_level isn't
  // 'verified'). `audited: false` distinguishes a deliberate skip from a
  // completed audit. Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K):
  // lib/inngest/functions/notify.ts's permitNotify is the first real
  // subscriber.
  'permit/application.audited': {
    applicationId: string;
    auditId: string | null;
    audited: boolean;
  };
  // Emitted by a confirm-review API route (app/api/applications/[id]/confirm-
  // review/route.ts) once a human has confirmed every audit_findings row for
  // a 'verified'-tier application's latest audit is no longer 'unverified'.
  // The route itself sets status='reviewed' before sending this -- it is the
  // second of the two triggers lib/inngest/functions/generate-pdf.ts listens
  // on (the first, 'permit/application.audited', covers the 'assisted'-tier
  // direct-fill path, since that tier never goes through human review at
  // all). See generate-pdf.ts's header comment for why one function safely
  // subscribes to both.
  'permit/application.review_confirmed': { applicationId: string };
  // Emitted after permit.generate_pdf finishes, including the "skipped"
  // case (coverage_level/status made the application ineligible for PDF
  // generation at the time this run executed -- re-derived from the DB,
  // never trusted from the triggering event, same discipline as permit.audit's
  // own coverage_level re-check). `succeeded: false` with a non-empty
  // generatedDocumentIds array cannot happen -- either every eligible filing
  // produced a row, or none did and the application is routed to
  // 'document_generation_failed'. Gate 5, sub-phase 5.3: permitNotify (see
  // 'permit/application.audited' above) is the first real subscriber.
  'permit/application.pdf_generated': {
    applicationId: string;
    generatedDocumentIds: string[];
    succeeded: boolean;
  };
  // Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K). Emitted once a single
  // drawing/blueprint document is ready to be reviewed against retrieved
  // jurisdiction code excerpts -- one event per application_documents row,
  // NOT per application (unlike 'permit/application.documents_ready'),
  // since a drawing review is scoped to one drawing sheet at a time (see
  // drawing_reviews.application_document_id, 20260806000045). No real
  // sender exists yet in this sub-phase -- per GATE_5_FINDINGS.md §K's own
  // 5.2 scope, wiring a real trigger call site (e.g. from the document
  // upload route, gated on doc_kind = 'blueprint') is deferred to 5.4. Named
  // and declared now so lib/inngest/functions/drawing-review.ts has an event
  // to subscribe to before that caller exists, same "declared ahead of its
  // consumer" pattern as every flag in lib/flags.ts.
  'permit/application.drawing_review_ready': {
    applicationId: string;
    applicationDocumentId: string;
  };
  // Emitted after permit.drawing_review finishes, including the "skipped"
  // case (drawing review disabled by flag, or the jurisdiction's
  // coverage_level isn't 'verified') -- same `reviewed: false` distinguishes
  // a deliberate skip from a completed review, mirroring
  // 'permit/application.audited''s own `audited` field. Gate 5, sub-phase
  // 5.3: permitNotify (see 'permit/application.audited' above) is the first
  // real subscriber.
  'permit/application.drawing_reviewed': {
    applicationId: string;
    applicationDocumentId: string;
    drawingReviewId: string | null;
    reviewed: boolean;
  };
  // Gate 5, sub-phase 5.3 hardening (digest/batching). Purely-internal
  // signal, never emitted by anything outside
  // lib/inngest/functions/notify.ts itself: permitNotify emits this once per
  // enqueued notification_pending_events row, and permitNotifyFlush (the
  // sole subscriber) uses its `debounce` config -- keyed on applicationId --
  // to collapse a rapid-fire burst of these into a single delayed run per
  // application, which then reads every still-pending row for that
  // application from the DB (never from this event's own payload -- see
  // 20260806000050_notification_pending_events.sql's header comment on why)
  // and sends one combined digest email per recipient.
  'permit/notification.queued': { applicationId: string };
}
