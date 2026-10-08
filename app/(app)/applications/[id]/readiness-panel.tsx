import { PERMIT_STATUS_LABELS } from '@/lib/dashboard/labels';
import type { PermitStatus } from '@/lib/permit-status/transitions';
import { MIN_OVERRIDE_REASON_LENGTH, nextPermitStatusOptions } from '@/lib/readiness/readiness';
import { reviewStatus } from '@/lib/requirements/review';
import { createClient } from '@/lib/supabase/server';
import {
  AddChecklistItemForm,
  AddSuggestedItemsButton,
  ChecklistItemActions,
  OverrideReadinessForm,
  PermitStatusForm,
} from './readiness-controls';

// "Permit progress" panel (PERMITFIELD_FF_READINESS): the permit's own status
// (permit_status, 20260806000022) and the readiness checklist that gates its
// "Ready to submit" step (20260806000025). Everything shown is re-checked by
// the database when acted on.

interface ChecklistItem {
  id: string;
  title: string;
  description: string | null;
  is_required: boolean;
  responsible_party: string | null;
  due_date: string | null;
  status: 'pending' | 'complete' | 'rejected';
  rejection_reason: string | null;
  source_requirement: string | null;
  // The city requirement this item was copied from, with its review state.
  permit_requirements: CatalogReview | CatalogReview[] | null;
}

interface CatalogReview {
  verification_status: string;
  verified_at: string | null;
  archived_at: string | null;
}

// Verified (and not due for a re-check) by a named reviewer on the admin
// Requirements review page.
function isReviewed(item: ChecklistItem): boolean {
  const review = Array.isArray(item.permit_requirements) ? item.permit_requirements[0] : item.permit_requirements;
  return review ? reviewStatus({ ...review, archived_at: null }) === 'verified' : false;
}

interface HistoryRow {
  id: string;
  from_status: PermitStatus | null;
  to_status: PermitStatus;
  reason: string | null;
  created_at: string;
}

const OVERRIDE_ROLES = ['owner', 'org_owner', 'platform_admin', 'permit_manager'];
const DELETE_ROLES = ['owner', 'org_owner'];

const ITEM_STATUS_STYLE: Record<ChecklistItem['status'], string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  complete: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};

function isSourceUrl(value: string | null): value is string {
  return value !== null && value.startsWith('https://');
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function ReadinessPanel({
  orgId,
  applicationId,
  role,
  permitStatus,
  override,
}: {
  orgId: string;
  applicationId: string;
  role: string;
  permitStatus: PermitStatus | null;
  override: { at: string; reason: string } | null;
}) {
  const supabase = await createClient();
  const [{ data: items, error: itemsError }, { data: score }, { data: history }] = await Promise.all([
    supabase
      .from('readiness_checklist_items')
      .select(
        'id, title, description, is_required, responsible_party, due_date, status, rejection_reason, source_requirement, permit_requirements ( verification_status, verified_at, archived_at )'
      )
      .eq('org_id', orgId)
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true }),
    supabase.rpc('compute_readiness_score', { p_application_id: applicationId }),
    supabase
      .from('application_status_history')
      .select('id, from_status, to_status, reason, created_at')
      .eq('org_id', orgId)
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);
  if (itemsError) {
    throw new Error(`Failed to load the readiness checklist: ${itemsError.message}`);
  }

  const checklist = (items ?? []) as ChecklistItem[];
  const requiredOpen = checklist.filter((item) => item.is_required && item.status !== 'complete').length;
  const scoreValue = score === null || score === undefined ? null : Number(score);
  const options = nextPermitStatusOptions(permitStatus, role).map((value) => ({ value, label: PERMIT_STATUS_LABELS[value] }));
  const today = new Date().toISOString().slice(0, 10);
  const hasUnreviewedCityItems = checklist.some((item) => isSourceUrl(item.source_requirement) && !isReviewed(item));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Permit progress</h2>

      <div className="mt-3 rounded-md border border-zinc-200 p-3">
        <p className="text-xs text-zinc-500">Permit status</p>
        <p className="mt-0.5 text-sm font-medium text-zinc-900">{permitStatus ? PERMIT_STATUS_LABELS[permitStatus] : 'Not started'}</p>
        {options.length > 0 ? (
          <div className="mt-3">
            {/* Keyed by status so the choice resets to the new first option after each move. */}
            <PermitStatusForm key={permitStatus ?? 'none'} applicationId={applicationId} options={options} />
          </div>
        ) : permitStatus === 'ready_to_submit' ? null : (
          <p className="mt-2 text-xs text-zinc-500">No further status changes are available to your role from here.</p>
        )}
        {permitStatus === 'ready_to_submit' && (
          <p className="mt-2 text-xs text-zinc-600">Submitting the application to the authority moves this to Submitted.</p>
        )}
        {(history ?? []).length > 0 && (
          <ul className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-600">
            {((history ?? []) as HistoryRow[]).map((row) => (
              <li key={row.id}>
                {new Date(row.created_at).toLocaleDateString('en-CA')} · {row.from_status ? `${PERMIT_STATUS_LABELS[row.from_status]} → ` : ''}
                {PERMIT_STATUS_LABELS[row.to_status]}
                {row.reason ? ` -- ${row.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 rounded-md border border-zinc-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Readiness</p>
            <p className="mt-0.5 text-sm font-medium text-zinc-900">
              {scoreValue === null ? '—' : `${Math.round(scoreValue)}%`}
              <span className="ml-2 text-xs font-normal text-zinc-600">
                {requiredOpen === 0 ? 'All required items complete' : `${requiredOpen} required item${requiredOpen === 1 ? '' : 's'} left`}
              </span>
            </p>
          </div>
          <AddSuggestedItemsButton applicationId={applicationId} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Required items must be complete before the status can move to Ready to submit.
        </p>
        {hasUnreviewedCityItems && (
          <p className="mt-1 text-xs text-zinc-500">
            Items with a source link are copied from the authority&apos;s published requirements. Those marked &ldquo;not yet
            reviewed&rdquo; haven&apos;t been checked by PermitField yet. Optional ones apply only if your scope triggers them. The
            authority can still ask for more.
          </p>
        )}

        {checklist.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-600">No checklist items yet. Add your own, or start from the suggested items.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
            {checklist.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-900">
                    {item.title}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${ITEM_STATUS_STYLE[item.status]}`}>
                      {item.status === 'complete' ? 'Complete' : item.status === 'rejected' ? 'Rejected' : 'To do'}
                    </span>
                    {!item.is_required && <span className="ml-1 text-[11px] text-zinc-500">optional</span>}
                  </p>
                  {item.description && <p className="text-xs text-zinc-600">{item.description}</p>}
                  {isSourceUrl(item.source_requirement) && (
                    <a
                      href={item.source_requirement}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-500 underline hover:text-zinc-700"
                    >
                      Source: {sourceHost(item.source_requirement)}
                    </a>
                  )}
                  {isSourceUrl(item.source_requirement) && (
                    <span className={`ml-2 text-[11px] ${isReviewed(item) ? 'text-emerald-700' : 'text-zinc-500'}`}>
                      {isReviewed(item) ? 'Verified by PermitField' : 'Not yet reviewed'}
                    </span>
                  )}
                  <p className="text-xs text-zinc-500">
                    {[
                      item.responsible_party,
                      item.due_date && `due ${item.due_date}${item.status !== 'complete' && item.due_date < today ? ' (overdue)' : ''}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {item.status === 'rejected' && item.rejection_reason && (
                    <p className="text-xs text-red-700">Rejected: {item.rejection_reason}</p>
                  )}
                </div>
                <ChecklistItemActions
                  applicationId={applicationId}
                  itemId={item.id}
                  status={item.status}
                  canDelete={DELETE_ROLES.includes(role)}
                />
              </li>
            ))}
          </ul>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-700">Add an item</summary>
          <div className="mt-2">
            <AddChecklistItemForm applicationId={applicationId} />
          </div>
        </details>

        {override ? (
          <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
            Readiness override recorded {new Date(override.at).toLocaleString()}: {override.reason}
          </p>
        ) : (
          requiredOpen > 0 &&
          OVERRIDE_ROLES.includes(role) && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-zinc-700">Go ahead without the remaining items</summary>
              <p className="mt-1 text-xs text-zinc-600">
                Records an override on the application permanently, with your reason, and lets the status move to Ready to submit.
              </p>
              <div className="mt-2">
                <OverrideReadinessForm applicationId={applicationId} minLength={MIN_OVERRIDE_REASON_LENGTH} />
              </div>
            </details>
          )
        )}
      </div>
    </section>
  );
}
