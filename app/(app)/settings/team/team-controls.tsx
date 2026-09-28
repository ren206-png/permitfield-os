'use client';

import { useActionState, useState } from 'react';
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type AssignableRole } from '@/lib/team/team';
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction, type TeamActionState } from './actions';

const initialState: TeamActionState = {};
const input = 'rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900';
const primaryButton =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';
const linkButton = 'text-xs font-medium underline underline-offset-2 disabled:opacity-60';

function Result({ state }: { state: TeamActionState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) {
    return (
      <p role="alert" className="mt-1 text-xs text-red-600">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <div role="status" className="mt-1 flex flex-col gap-1 text-xs text-emerald-700">
      <p>{state.message}</p>
      {state.inviteUrl && (
        <div className="flex items-center gap-2">
          <input readOnly value={state.inviteUrl} className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-zinc-700" />
          <button
            type="button"
            className="font-medium text-zinc-900 underline underline-offset-2"
            onClick={() => void navigator.clipboard.writeText(state.inviteUrl ?? '').then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}

export function InviteForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [state, formAction, pending] = useActionState(async (prev: TeamActionState, formData: FormData) => {
    const result = await inviteMemberAction(prev, formData);
    // React resets the form after the action; clear both fields so the
    // role picker and its description stay in step.
    if (!result.error) {
      setEmail('');
      setRole('member');
    }
    return result;
  }, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Email
          <input name="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-700">
          Role
          <select name="role" value={role} onChange={(event) => setRole(event.target.value as AssignableRole)} className={input}>
            {ASSIGNABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
      <p className="text-xs text-zinc-500">{ROLE_DESCRIPTIONS[role]}</p>
      <Result state={state} />
    </form>
  );
}

export function MemberRoleForm({ memberId, role, isSelf }: { memberId: string; role: string; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState(changeRoleAction, initialState);
  const [removeState, removeAction, removing] = useActionState(removeMemberAction, initialState);
  const [value, setValue] = useState(role);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="memberId" value={memberId} />
          <select name="role" value={value} onChange={(event) => setValue(event.target.value)} className={`${input} py-1 text-xs`} aria-label="Role">
            {!ASSIGNABLE_ROLES.includes(role as AssignableRole) && <option value={role}>{ROLE_LABELS[role] ?? role}</option>}
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
          {value !== role && (
            <button type="submit" disabled={pending} className={`${linkButton} text-zinc-900`}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          )}
        </form>
        <form
          action={removeAction}
          onSubmit={(event) => {
            const question = isSelf ? 'Remove yourself from this organization? You will lose access.' : 'Remove this person from the team?';
            if (!window.confirm(question)) event.preventDefault();
          }}
        >
          <input type="hidden" name="memberId" value={memberId} />
          <button type="submit" disabled={removing} className={`${linkButton} text-red-600`}>
            Remove
          </button>
        </form>
      </div>
      <Result state={state} />
      <Result state={removeState} />
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, initialState);
  return (
    <form action={formAction} className="flex flex-col items-end">
      <input type="hidden" name="invitationId" value={invitationId} />
      <button type="submit" disabled={pending} className={`${linkButton} text-zinc-700`}>
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      <Result state={state} />
    </form>
  );
}
