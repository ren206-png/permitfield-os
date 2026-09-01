'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/admin';
import { issueToken, revokeToken, type IssueTokenResult, type RevokeTokenResult } from '@/lib/bridge/client-portal';

// Server Actions for the staff-facing client-portal token admin UI
// (app/admin/client-portal/). Both re-run requireAdmin() themselves --
// never trust that the page that rendered the calling form already checked
// it, since a Server Action is a public, directly-invokable endpoint on its
// own, same "each route/action re-derives its own authorization" discipline
// app/admin/layout.tsx's header comment describes for pages.

export interface IssueTokenState {
  error?: string;
  issuedRawToken?: string;
  issuedExpiresAt?: string;
  issuedRecipientEmail?: string;
}

function describeIssueError(error: Exclude<IssueTokenResult, { rawToken: string }>['error']): string {
  switch (error) {
    case 'client_portal_disabled':
      return 'PERMITFIELD_FF_CLIENT_PORTAL is off -- enable it before issuing tokens.';
    case 'application_not_found':
      return 'That application no longer exists or moved organizations.';
    case 'invalid_recipient_email':
      return 'Enter a valid recipient email.';
    case 'issue_failed':
      return 'Issuing the token failed. Check server logs and try again.';
  }
}

export async function issueTokenAction(_prevState: IssueTokenState, formData: FormData): Promise<IssueTokenState> {
  const admin = await requireAdmin();

  const applicationId = String(formData.get('applicationId') ?? '').trim();
  const orgId = String(formData.get('orgId') ?? '').trim();
  const recipientEmail = String(formData.get('recipientEmail') ?? '').trim();
  const recipientName = String(formData.get('recipientName') ?? '').trim();

  if (!applicationId || !orgId) {
    return { error: 'Missing application context -- reload the page and try again.' };
  }
  if (!recipientEmail) {
    return { error: 'Recipient email is required.' };
  }

  const result = await issueToken({
    applicationId,
    orgId,
    recipientEmail,
    recipientName: recipientName || null,
    issuedByOrgUserId: admin.id,
  });

  if ('error' in result) {
    return { error: describeIssueError(result.error) };
  }

  revalidatePath('/admin/client-portal');

  return {
    issuedRawToken: result.rawToken,
    issuedExpiresAt: result.expiresAt,
    issuedRecipientEmail: recipientEmail,
  };
}

export interface RevokeTokenState {
  error?: string;
  revoked?: boolean;
}

function describeRevokeError(error: Exclude<RevokeTokenResult, { revoked: true }>['error']): string {
  switch (error) {
    case 'client_portal_disabled':
      return 'PERMITFIELD_FF_CLIENT_PORTAL is off.';
    case 'token_not_found':
      return 'That token no longer exists.';
    case 'already_inactive':
      return 'That token is already revoked, expired, or superseded.';
    case 'revoke_failed':
      return 'Revoking the token failed. Check server logs and try again.';
  }
}

export async function revokeTokenAction(_prevState: RevokeTokenState, formData: FormData): Promise<RevokeTokenState> {
  const admin = await requireAdmin();

  const tokenId = String(formData.get('tokenId') ?? '').trim();
  if (!tokenId) {
    return { error: 'Missing token id.' };
  }

  const result = await revokeToken(tokenId, admin.id);
  if ('error' in result) {
    return { error: describeRevokeError(result.error) };
  }

  revalidatePath('/admin/client-portal');

  return { revoked: true };
}
