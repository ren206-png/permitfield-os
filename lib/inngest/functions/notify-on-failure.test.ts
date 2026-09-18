import { describe, it, expect } from 'vitest';
import { classifyFailure } from './notify-on-failure';

// PERMITFIELD_FF_FAILURE_NOTIFICATIONS. Pure-function tests, no network/DB --
// same discipline as lib/ai/router.test.ts. classifyFailure() is exported
// specifically so every branch of its event-name / boolean-flag /
// live-status matrix can be pinned down without spinning up Inngest or a
// real Supabase client (see that function's own header comment).
//
// The 'audited' and 'pdf_generated' branches are the ones worth the most
// coverage here: both events are overloaded (see classifyFailure's header
// comment for the full breakdown of every call site that emits
// audited:false / succeeded:false), so the cases below deliberately include
// every liveApplicationStatus value that must resolve to null despite the
// boolean flag alone looking like a failure.

describe('classifyFailure()', () => {
  describe('permit/application.extracted', () => {
    it('returns null when extraction succeeded (zodValid: true)', () => {
      expect(classifyFailure('permit/application.extracted', { applicationId: 'a', extractionId: 'e', zodValid: true }, null)).toBeNull();
    });

    it('classifies extraction_failed when zodValid is false', () => {
      const result = classifyFailure(
        'permit/application.extracted',
        { applicationId: 'a', extractionId: 'e', zodValid: false },
        null
      );
      expect(result).toEqual({
        kind: 'extraction_failed',
        message: 'Document extraction failed and could not be validated. Review the uploaded documents and retry.',
      });
    });
  });

  describe('permit/application.audited', () => {
    it('returns null when audited: true', () => {
      expect(
        classifyFailure('permit/application.audited', { applicationId: 'a', auditId: 'aud', audited: true }, 'audit_failed')
      ).toBeNull();
    });

    it('classifies audit_failed when audited: false and live status is audit_failed', () => {
      const result = classifyFailure(
        'permit/application.audited',
        { applicationId: 'a', auditId: null, audited: false },
        'audit_failed'
      );
      expect(result).toEqual({
        kind: 'audit_failed',
        message: 'The compliance audit failed and produced no results. Review the application and retry.',
      });
    });

    // Extraction having already failed leaves status at 'extraction_failed'
    // (never overwritten) -- notifying again here would duplicate the
    // 'extracted' branch's own notification for the same root cause.
    it('returns null when audited: false but live status is still extraction_failed (already notified upstream)', () => {
      expect(
        classifyFailure('permit/application.audited', { applicationId: 'a', auditId: null, audited: false }, 'extraction_failed')
      ).toBeNull();
    });

    // PERMITFIELD_FF_AI_AUDIT off, or a non-'verified' coverage tier -- a
    // deliberate, benign skip that leaves status unchanged and is never a
    // real failure at all.
    it('returns null when audited: false but live status reflects a benign skip, not a failure', () => {
      expect(
        classifyFailure('permit/application.audited', { applicationId: 'a', auditId: null, audited: false }, 'extracted')
      ).toBeNull();
    });
  });

  describe('permit/application.pdf_generated', () => {
    it('returns null when succeeded: true', () => {
      expect(
        classifyFailure(
          'permit/application.pdf_generated',
          { applicationId: 'a', generatedDocumentIds: ['d1'], succeeded: true },
          'document_generation_failed'
        )
      ).toBeNull();
    });

    it('classifies document_generation_failed when succeeded: false and live status is document_generation_failed', () => {
      const result = classifyFailure(
        'permit/application.pdf_generated',
        { applicationId: 'a', generatedDocumentIds: [], succeeded: false },
        'document_generation_failed'
      );
      expect(result).toEqual({
        kind: 'document_generation_failed',
        message: 'Permit document generation failed -- no filled PDF was produced for this application.',
      });
    });

    // The "not eligible yet" skip (e.g. a 'verified'-tier application's
    // 'audited' trigger firing before review-confirmation) fires
    // succeeded:false on every audited event for that tier, not just
    // failures -- status is left unchanged, so it must resolve to null.
    it('returns null when succeeded: false but live status reflects a benign ineligibility skip, not a failure', () => {
      expect(
        classifyFailure('permit/application.pdf_generated', { applicationId: 'a', generatedDocumentIds: [], succeeded: false }, 'reviewed')
      ).toBeNull();
    });
  });
});
