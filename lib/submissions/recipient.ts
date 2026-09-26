// Who actually receives an authority submission email. Pure so the safety
// rule is unit-tested: outside Vercel Production a submission is never
// emailed to a real authority -- it goes to PERMITFIELD_SUBMISSION_EMAIL_OVERRIDE
// or is refused. In production the override, if set, still wins (useful for
// a controlled end-to-end test), otherwise the authority's verified address.
export type RecipientResult =
  | { ok: true; to: string; overridden: boolean }
  | { ok: false; error: string };

export function resolveSubmissionRecipient(input: {
  authorityEmail: string | null;
  vercelEnv: string | undefined;
  overrideEmail: string | undefined;
}): RecipientResult {
  const override = input.overrideEmail?.trim();
  if (override) {
    return { ok: true, to: override, overridden: true };
  }
  if (input.vercelEnv !== 'production') {
    return {
      ok: false,
      error:
        'Submissions are only emailed to authorities from production. Set PERMITFIELD_SUBMISSION_EMAIL_OVERRIDE to send test submissions to yourself.',
    };
  }
  if (!input.authorityEmail) {
    return { ok: false, error: 'This authority has no verified submission email address.' };
  }
  return { ok: true, to: input.authorityEmail, overridden: false };
}
