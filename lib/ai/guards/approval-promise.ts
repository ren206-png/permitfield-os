// Gate AI-1, sub-phase AI-1.1 (GATE_AI_1_FINDINGS.md §H, APPROVAL_PROMISE:
// "output contains 'will be approved'/'guaranteed' and reaches the user").
// That findings pass confirmed both existing system prompts already
// instruct the model not to assert compliance
// (lib/ai/extract-permit-data.ts / lib/ai/audit-permit-data.ts, "You are
// not the authority having jurisdiction and you do not determine
// [legal] compliance") -- but a prompt instruction is not an enforcement
// layer, the same reasoning that makes every citation check in this codebase
// (findInvalidSourceCitations, validateAuditFindingItem) a re-validation in
// application code rather than a trust in the model's own claimed
// discipline. This module is that second layer for approval-promise
// language specifically: a deterministic, post-generation phrase scan, not
// a smarter model or a longer prompt.
//
// ZERO LIVE CALL SITES as of this sub-phase -- no UI renders any AI output
// anywhere in this codebase yet (GATE_AI_1_FINDINGS.md §H's own finding).
// This exists now so AI-1.4 (the first sub-phase to put AI output in front
// of a user) has a ready-made guard to call before rendering/persisting any
// free-text model output, rather than inventing one under deadline.
//
// Deliberately conservative and English-only for this first pass: false
// positives (flagging a benign sentence) are a UX annoyance a human reviewer
// can override; false negatives (letting a real promise-of-approval
// statement reach an applicant) are the actual harm SS-level "never assert
// compliance" rules exist to prevent. Callers that need this scan applied
// to structured extraction/audit fields already have their own narrower
// validation (Zod schemas, citation checks) -- this guard is for
// free-text output a human will actually read, e.g. an AI-1.4 assistant
// response or a generated checklist note.

const APPROVAL_PROMISE_PHRASES: readonly string[] = [
  'will be approved',
  'will get approved',
  'guaranteed approval',
  'guaranteed to be approved',
  'guaranteed to pass',
  'will pass inspection',
  'is approved',
  'permit is approved',
  'you are approved',
  'your permit will be issued',
  'this will definitely',
  'no issues will arise',
  '100% approved',
];

export interface ApprovalPromiseCheckResult {
  /** True if any banned phrase was found (case-insensitive substring match). */
  matched: boolean;
  /** The exact phrases (from APPROVAL_PROMISE_PHRASES) that were found. */
  matchedPhrases: string[];
}

/**
 * Scans free-text model output for approval-promise / compliance-guarantee
 * language. Case-insensitive substring match, deliberately simple (no NLP,
 * no fuzzy matching) so its behavior is auditable and testable by exact
 * example, same discipline as the rest of lib/ai/'s validation layer.
 *
 * Does not throw -- callers decide what "matched: true" means for their
 * context (AI-1.4's expected use: reject/withhold the response and fall
 * back to a generic message, or route it to human review, rather than
 * showing it to the applicant).
 */
export function checkApprovalPromiseLanguage(text: string): ApprovalPromiseCheckResult {
  const lowered = text.toLowerCase();
  const matchedPhrases = APPROVAL_PROMISE_PHRASES.filter((phrase) =>
    lowered.includes(phrase.toLowerCase())
  );
  return { matched: matchedPhrases.length > 0, matchedPhrases };
}
