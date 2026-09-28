import { createHash, randomBytes } from 'node:crypto';

// Team management (20260806000074_org_invitations.sql). Pure helpers so the
// token handling, role list and error wording are unit-tested.

/** Roles an owner can give -- the ones the database actually treats differently. */
export const ASSIGNABLE_ROLES = ['owner', 'permit_manager', 'permit_coordinator', 'member'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  permit_manager: 'Permit manager',
  permit_coordinator: 'Permit coordinator',
  member: 'Member',
  org_owner: 'Org owner',
  platform_admin: 'Platform admin',
  document_reviewer: 'Document reviewer',
  applicant_contractor: 'Applicant contractor',
  auditor_readonly: 'Auditor',
  client_user: 'Client',
};

export const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  owner: 'Everything, including the team, billing and deleting records.',
  permit_manager: 'Submits applications, requests signatures, records overrides and invoices.',
  permit_coordinator: 'Day-to-day work, plus recording the authority’s decisions (approved, issued…).',
  member: 'Day-to-day work on applications, clients and documents.',
};

export function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new invitation token (the raw value goes only into the emailed link). */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores and looks up by. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// The team functions raise 'code: detail'; turn them into next steps.
export function teamErrorMessage(message: string): string {
  if (message.includes('last_owner')) return 'The organization needs at least one owner. Make someone else an owner first.';
  if (message.includes('already_member')) return 'That person is already on the team.';
  if (message.includes('email_mismatch')) {
    const match = /sign in as (\S+)/.exec(message);
    return `This invitation is for ${match ? match[1] : 'a different email'}. Sign out and sign in with that address to accept it.`;
  }
  if (message.includes('invitation_expired')) return 'This invitation has expired. Ask for a new one.';
  if (message.includes('invitation_unavailable')) return 'This invitation is no longer valid. Ask for a new one.';
  if (message.includes('not_authorized') || message.includes('permission denied')) return 'Only owners can manage the team.';
  if (message.includes('invalid_role')) return 'That role can’t be given here.';
  return 'That didn’t work. Try again.';
}
