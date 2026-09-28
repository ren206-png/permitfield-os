import { describe, it, expect } from 'vitest';
import { generateInviteToken, hashInviteToken, INVITE_TOKEN_PATTERN, isAssignableRole, teamErrorMessage } from './team';

describe('invite tokens', () => {
  it('are 32 random bytes as URL-safe text, stored only as a sha256 hash', () => {
    const token = generateInviteToken();
    expect(token).toMatch(INVITE_TOKEN_PATTERN);
    expect(generateInviteToken()).not.toBe(token);
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });
});

describe('isAssignableRole()', () => {
  it('allows only the roles the database enforces', () => {
    expect(isAssignableRole('permit_manager')).toBe(true);
    expect(isAssignableRole('platform_admin')).toBe(false);
    expect(isAssignableRole('client_user')).toBe(false);
  });
});

describe('teamErrorMessage()', () => {
  it('explains what to do', () => {
    expect(teamErrorMessage('last_owner: the organization needs at least one owner')).toMatch(/at least one owner/);
    expect(teamErrorMessage('email_mismatch: sign in as pat@example.test to accept this invitation')).toContain('pat@example.test');
    expect(teamErrorMessage('invitation_expired: …')).toMatch(/expired/);
    expect(teamErrorMessage('permission denied for function x')).toMatch(/Only owners/);
    expect(teamErrorMessage('boom')).toMatch(/Try again/);
  });
});
