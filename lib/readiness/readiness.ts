import {
  canRoleTransitionTo,
  isValidPermitStatusTransition,
  PERMIT_STATUS_TRANSITIONS,
  type PermitStatus,
  type PermitStatusRole,
} from '@/lib/permit-status/transitions';

// Pure helpers behind the application page's "Permit progress" panel
// (readiness checklist + permit status), unit-tested without a database.
// The database remains the enforcement: transition_permit_status() and
// override_readiness_check() (20260806000025) re-check everything these
// helpers only use to decide what to show.

export const MIN_OVERRIDE_REASON_LENGTH = 20;

/**
 * The next permit statuses to offer this role from `from`: legal edges the
 * role's tier allows. `submitted` is left out -- it is reached by actually
 * submitting (the Submit panel moves it, and the database refuses it until
 * the document pipeline is submitted), not by a status button.
 */
export function nextPermitStatusOptions(from: PermitStatus | null, role: string): PermitStatus[] {
  const candidates = PERMIT_STATUS_TRANSITIONS[from ?? 'null'] ?? [];
  return candidates.filter(
    (to) => to !== 'submitted' && isValidPermitStatusTransition(from, to) && canRoleTransitionTo(role as PermitStatusRole, to)
  );
}

// transition_permit_status() / override_readiness_check() raise
// 'code: detail' messages; these are the ones a person can act on.
export function permitStatusErrorMessage(message: string): string {
  if (message.includes('readiness_incomplete')) {
    return 'Finish the required checklist items first, or record an override with a reason.';
  }
  if (message.includes('insufficient_privilege')) {
    return 'Your role can’t make this change. Ask a permit manager or the owner.';
  }
  if (message.includes('invalid_transition')) {
    return 'That step isn’t allowed from the current status. Refresh and try again.';
  }
  if (message.includes('concurrent_transition')) {
    return 'Someone else changed the status just now. Refresh and try again.';
  }
  if (message.includes('pipeline_not_submitted')) {
    return 'Submit the application first; the status moves to submitted when you do.';
  }
  if (message.includes('invalid_reason')) {
    return `Give a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters.`;
  }
  return 'That change could not be saved. Try again.';
}

export interface SuggestedItemInput {
  filings: { authorityName: string; hasFilledForm: boolean; esignatureAccepted: boolean; hasSignatureSlot: boolean }[];
  existingTitles: string[];
}

export interface SuggestedItem {
  title: string;
  description: string;
}

/**
 * A starter checklist from what the application already has: one check per
 * filled form, a signature step where the form is signed, and the supporting
 * documents. Titles already on the checklist are skipped, so it can be run
 * again safely.
 */
export function suggestedChecklistItems(input: SuggestedItemInput): SuggestedItem[] {
  const items: SuggestedItem[] = [];
  for (const filing of input.filings) {
    if (filing.hasFilledForm) {
      items.push({
        title: `Check the filled ${filing.authorityName} form`,
        description: 'Read every filled field against the drawings and contract before it goes out.',
      });
    }
    if (filing.hasSignatureSlot) {
      items.push({
        title: `Get the ${filing.authorityName} form signed`,
        description: filing.esignatureAccepted
          ? 'Send it for electronic signature from the Signatures panel.'
          : 'Print it and have the applicant sign by hand.',
      });
    }
  }
  items.push({
    title: 'Attach drawings and supporting documents',
    description: 'Everything the authority asks for, as PDFs.',
  });
  const existing = new Set(input.existingTitles.map((t) => t.trim().toLowerCase()));
  return items.filter((item) => !existing.has(item.title.toLowerCase()));
}
