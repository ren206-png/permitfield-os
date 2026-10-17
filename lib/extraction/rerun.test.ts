import { describe, expect, it } from 'vitest';
import { documentsFingerprint, extractionBlockReason } from './rerun';

describe('documentsFingerprint', () => {
  it('is the same for the same files in any order, and for duplicates', () => {
    expect(documentsFingerprint(['b', 'a'])).toBe(documentsFingerprint(['a', 'b']));
    expect(documentsFingerprint(['a', 'a', 'b'])).toBe(documentsFingerprint(['a', 'b']));
  });

  it('changes when a file is added', () => {
    expect(documentsFingerprint(['a', 'b', 'c'])).not.toBe(documentsFingerprint(['a', 'b']));
  });

  it('is a fixed-length hex string', () => {
    expect(documentsFingerprint(['a'])).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('extractionBlockReason', () => {
  it('allows a first run and a re-run before signing or submission', () => {
    for (const status of ['draft', 'extracted', 'extraction_failed', 'documents_generated', 'document_generation_failed', 'reviewed']) {
      expect(extractionBlockReason({ status, hasSignedForm: false })).toBeNull();
    }
  });

  it('refuses after submission', () => {
    expect(extractionBlockReason({ status: 'submitted', hasSignedForm: false })).toMatch(/already been submitted/);
  });

  it('refuses while a run is in progress', () => {
    for (const status of ['uploading', 'extracting', 'auditing', 'generating_documents']) {
      expect(extractionBlockReason({ status, hasSignedForm: false })).toMatch(/already running/);
    }
  });

  it('refuses once a form is signed', () => {
    expect(extractionBlockReason({ status: 'documents_generated', hasSignedForm: true })).toMatch(/already signed/);
  });
});
