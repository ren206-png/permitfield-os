import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isFailureNotificationsEnabled } from '@/lib/flags';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { markNotificationReadAction } from './actions';

interface NotificationRow {
  id: string;
  application_id: string;
  kind: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  extraction_failed: 'Extraction failed',
  audit_failed: 'Audit failed',
  document_generation_failed: 'Document generation failed',
};

// Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS). Same
// notFound()-before-anything-else gate as app/(app)/projects/new/page.tsx's
// own isIntakeEnabled() check -- flag off means this route 404s regardless
// of who's signed in, matching that file's header comment discipline.
export default async function NotificationsPage() {
  if (!isFailureNotificationsEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  // RLS (`notifications_select`, is_org_member(org_id)) already scopes this
  // to the caller's org -- the explicit .eq('org_id', orgId) is redundant
  // with RLS but kept anyway so this query reads correctly on its own, same
  // discipline app/(app)/applications/page.tsx's own header comment
  // describes. fetchAllRows guards the same PostgREST 1000-row cap that
  // page's own header comment documents -- an org's notification backlog is
  // unbounded over time even though the *unread* set (this table's other,
  // partial-indexed access pattern) typically isn't.
  const notifications = await fetchAllRows<NotificationRow>(
    (from, to) =>
      supabase
        .from('notifications')
        .select('id, application_id, kind, message, read_at, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to),
    'notifications'
  );

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Notifications</h1>

      {notifications && notifications.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-4 shadow-sm ${
                n.read_at ? 'border-zinc-200 bg-white' : 'border-zinc-300 bg-zinc-50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{KIND_LABELS[n.kind] ?? n.kind}</p>
                  <p className="mt-1 text-sm text-zinc-600">{n.message}</p>
                  <p className="mt-2 text-xs text-zinc-400">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.read_at && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button
                      type="submit"
                      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Mark read
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No notifications yet.</p>
        </div>
      )}
    </div>
  );
}
