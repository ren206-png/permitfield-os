'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { PERMIT_STATUS_LABELS } from '@/lib/dashboard/labels';
import { ALL_PERMIT_STATUSES, type PermitStatus } from '@/lib/permit-status/transitions';
import {
  addConditionAction,
  approvePackageAction,
  conditionEventAction,
  preparePackageAction,
  recordInspectionAction,
  recordStatusAction,
  type LifecycleState,
} from './lifecycle-actions';

// Gate 6.6: what the authority said and asked, and what is being sent.
// Status evidence keeps the authority's own words and where they came from;
// a late or older update is kept as history and never overrides a newer
// status. Packages are drafts until approved internally, and an internal
// approval is never a government decision.

export interface LifecycleView {
  observations: { id: string; source: string; externalStatus: string; observedStatus: string | null; observedAt: string; outcome: string; reference: string | null }[];
  conditions: { id: string; text: string; category: string; status: string; note: string | null }[];
  inspections: { id: string; type: string; outcome: string; occurredOn: string; provenance: string; notes: string | null }[];
  packages: { id: string; version: number; sha256: string; createdAt: string; manifest: unknown; unresolved: number; approvedAt: string | null }[];
}

const initial: LifecycleState = {};
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';
const OUTCOME_BADGE: Record<string, string> = {
  applied: 'Applied',
  already_current: 'Already current',
  stale: 'Older: history only',
  not_applied_invalid: 'Not applied',
  recorded_only: 'Recorded only',
};
const SOURCE_LABEL: Record<string, string> = {
  authority_correspondence: 'Authority letter/email',
  user_reported: 'Reported by staff',
  connector: 'Portal connection',
  ai_suggestion: 'AI suggestion',
};

function useToasts(state: LifecycleState) {
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
}

function Form({ action, children, className }: { action: (fd: FormData) => void; children: React.ReactNode; className?: string }) {
  return (
    <form action={action} className={className}>
      {children}
    </form>
  );
}

function StatusForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(recordStatusAction, initial);
  useToasts(state);
  return (
    <Form action={action} className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <label className="text-xs font-medium text-zinc-700 sm:col-span-2">
        What the authority said, in their words
        <input name="externalStatus" required maxLength={500} placeholder="Permit issued -- conditions apply" className={inputClass} />
      </label>
      <label className="text-xs font-medium text-zinc-700">
        Means in PermitField
        <select name="observedStatus" defaultValue="" className={inputClass}>
          <option value="">Doesn&apos;t match a status</option>
          {ALL_PERMIT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PERMIT_STATUS_LABELS[s as PermitStatus] ?? s}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-zinc-700">
        Date the authority gave
        <input type="date" name="observedOn" required className={inputClass} />
      </label>
      <label className="text-xs font-medium text-zinc-700">
        Source
        <select name="source" defaultValue="authority_correspondence" className={inputClass}>
          <option value="authority_correspondence">Authority letter or email</option>
          <option value="user_reported">Seen or told (staff report)</option>
        </select>
      </label>
      <label className="text-xs font-medium text-zinc-700">
        Reference (optional)
        <input name="reference" maxLength={200} className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className={`${smallButton} justify-self-start`}>
        {pending ? 'Saving…' : 'Record status'}
      </button>
    </Form>
  );
}

function ConditionControls({ applicationId, conditionId, status }: { applicationId: string; conditionId: string; status: string }) {
  const [state, action, pending] = useActionState(conditionEventAction, initial);
  useToasts(state);
  return (
    <Form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="conditionId" value={conditionId} />
      <input name="note" maxLength={2000} placeholder="How it was met / who waived it" aria-label="Note" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs" />
      <select name="status" defaultValue={status === 'open' || status === 'reopened' ? 'satisfied' : 'reopened'} aria-label="Change to" className="rounded-md border border-zinc-300 px-1 py-1 text-xs">
        <option value="satisfied">Satisfied</option>
        <option value="waived_by_authority">Waived by authority</option>
        <option value="reopened">Reopen</option>
      </select>
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? '…' : 'Update'}
      </button>
    </Form>
  );
}

function ConditionForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(addConditionAction, initial);
  useToasts(state);
  return (
    <Form action={action} className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input name="conditionText" required maxLength={4000} placeholder="Condition, as written on the permit" aria-label="Condition" className={inputClass} />
      <select name="category" defaultValue="during_construction" aria-label="When" className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm">
        <option value="before_issuance">Before issuance</option>
        <option value="during_construction">During construction</option>
        <option value="before_occupancy">Before occupancy</option>
        <option value="inspection">Inspection</option>
        <option value="other">Other</option>
      </select>
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Saving…' : 'Add'}
      </button>
    </Form>
  );
}

function InspectionForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(recordInspectionAction, initial);
  useToasts(state);
  return (
    <Form action={action} className="grid gap-2 sm:grid-cols-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input name="inspectionType" required maxLength={200} placeholder="Inspection (e.g. Framing)" aria-label="Inspection" className={`${inputClass} sm:col-span-2`} />
      <select name="outcome" defaultValue="scheduled" aria-label="Result" className={inputClass}>
        <option value="scheduled">Scheduled</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="partial">Partial</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <input type="date" name="occurredOn" required aria-label="Date" className={inputClass} />
      <select name="provenance" defaultValue="authority_record" aria-label="Source" className={`${inputClass} sm:col-span-2`}>
        <option value="authority_record">From the inspector&apos;s report</option>
        <option value="user_reported">Reported by staff</option>
      </select>
      <input name="notes" maxLength={4000} placeholder="Notes" aria-label="Notes" className={inputClass} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Saving…' : 'Record inspection'}
      </button>
    </Form>
  );
}

function PackageControls({ applicationId, packages }: { applicationId: string; packages: LifecycleView['packages'] }) {
  const [prepState, prepare, preparing] = useActionState(preparePackageAction, initial);
  const [approveState, approve, approving] = useActionState(approvePackageAction, initial);
  useToasts(prepState);
  useToasts(approveState);
  const download = (p: LifecycleView['packages'][number]) => {
    const body = JSON.stringify(
      { ...(p.manifest as object), manifest_sha256: p.sha256, internal_approval: p.approvedAt ? { approved_at: p.approvedAt, note: 'Internal approval only; not a government decision.' } : null },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `package-v${p.version}${p.approvedAt ? '-approved' : '-draft'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2">
      <Form action={prepare}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <button type="submit" disabled={preparing} className={smallButton}>
          {preparing ? 'Preparing…' : 'Prepare package from current records'}
        </button>
      </Form>
      <ul className="divide-y divide-zinc-100 text-xs">
        {packages.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-zinc-700">
              v{p.version} · {p.unresolved} open item{p.unresolved === 1 ? '' : 's'} ·{' '}
              <span className={p.approvedAt ? 'text-emerald-700' : 'text-amber-800'}>{p.approvedAt ? 'approved internally' : 'draft'}</span>
              <span className="ml-1 font-mono text-zinc-400">{p.sha256.slice(0, 12)}</span>
            </span>
            <span className="flex gap-2">
              <button type="button" className={smallButton} onClick={() => download(p)}>
                Download
              </button>
              {!p.approvedAt && (
                <Form action={approve}>
                  <input type="hidden" name="applicationId" value={applicationId} />
                  <input type="hidden" name="packageId" value={p.id} />
                  <button type="submit" disabled={approving} className={smallButton}>
                    Approve internally
                  </button>
                </Form>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LifecyclePanel({ applicationId, view }: { applicationId: string; view: LifecycleView }) {
  return (
    <section className="space-y-5 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Permit lifecycle</h2>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Status from the authority</h3>
        <ul className="space-y-1 text-xs">
          {view.observations.map((o) => (
            <li key={o.id} className="flex flex-wrap gap-x-2 text-zinc-700">
              <span>{o.observedAt.slice(0, 10)}</span>
              <span className="font-medium text-zinc-900">“{o.externalStatus}”</span>
              <span className="text-zinc-500">{SOURCE_LABEL[o.source] ?? o.source}</span>
              <span className={o.outcome === 'applied' ? 'text-emerald-700' : o.outcome === 'stale' ? 'text-amber-800' : 'text-zinc-500'}>
                {OUTCOME_BADGE[o.outcome] ?? o.outcome}
              </span>
            </li>
          ))}
          {view.observations.length === 0 && <li className="text-zinc-500">Nothing recorded yet.</li>}
        </ul>
        <StatusForm applicationId={applicationId} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Conditions</h3>
        <ul className="space-y-2 text-sm">
          {view.conditions.map((c) => (
            <li key={c.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-zinc-900">{c.text}</span>
                <span className={c.status === 'satisfied' || c.status === 'waived_by_authority' ? 'text-xs text-emerald-700' : 'text-xs text-amber-800'}>
                  {c.status.replaceAll('_', ' ')}
                </span>
              </div>
              <ConditionControls applicationId={applicationId} conditionId={c.id} status={c.status} />
            </li>
          ))}
        </ul>
        <ConditionForm applicationId={applicationId} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Inspections</h3>
        <ul className="space-y-1 text-xs text-zinc-700">
          {view.inspections.map((i) => (
            <li key={i.id}>
              {i.occurredOn} · {i.type} · <span className="font-medium">{i.outcome}</span> · {i.provenance === 'authority_record' ? "inspector's report" : 'staff report'}
              {i.notes ? ` · ${i.notes}` : ''}
            </li>
          ))}
        </ul>
        <InspectionForm applicationId={applicationId} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Submission package</h3>
        <p className="text-xs text-zinc-600">
          A record of exactly what is being sent (forms, files with fingerprints, facts, checklist, open items). Preparing or approving it does not submit
          anything or change the permit status.
        </p>
        <PackageControls applicationId={applicationId} packages={view.packages} />
      </div>
    </section>
  );
}
