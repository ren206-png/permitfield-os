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
  // the subscriber to the success case; permit.notify_on_failure
  // (lib/inngest/functions/notify-on-failure.ts, PERMITFIELD_FF_FAILURE_NOTIFICATIONS)
  // is the subscriber to the failure case (zodValid: false).
  'permit/application.extracted': {
    applicationId: string;
    extractionId: string;
    zodValid: boolean;
  };
  // Emitted after permit.audit finishes, including the "skipped" case (AI
  // audit disabled by flag, or the jurisdiction's coverage_level isn't
  // 'verified'). `audited: false` distinguishes a deliberate skip from a
  // completed audit -- permit.notify_on_failure
  // (lib/inngest/functions/notify-on-failure.ts,
  // PERMITFIELD_FF_FAILURE_NOTIFICATIONS) is now a subscriber, and itself
  // re-derives permit_applications.status live rather than trusting
  // `audited: false` alone, since that one boolean covers both a genuine
  // audit_failed and the two benign skip cases (see that module's
  // classifyFailure() header comment for the full breakdown). generate-pdf.ts
  // is also a subscriber, on the 'assisted'-tier direct-fill path.
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
  // 'document_generation_failed'. permit.notify_on_failure
  // (lib/inngest/functions/notify-on-failure.ts,
  // PERMITFIELD_FF_FAILURE_NOTIFICATIONS) is now a subscriber; same as the
  // 'audited' event above, it re-derives status live before treating a
  // `succeeded: false` as a real failure, since the ineligible-skip case
  // also emits `succeeded: false` and is not itself a failure.
  'permit/application.pdf_generated': {
    applicationId: string;
    generatedDocumentIds: string[];
    succeeded: boolean;
  };
}
