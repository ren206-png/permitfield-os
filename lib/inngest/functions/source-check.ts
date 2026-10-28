import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { checkSource } from '@/lib/sources/check-source';
import { isCheckDue, type SourceType } from '@/lib/sources/freshness';

// Gate 6.3: source refresh (master prompt §7 "controlled refresh").
//
// source-check: fetches one registered source and records the outcome via
// record_source_check (20260806000094). Two durable steps: 'fetch' (network
// + parse, memoised by Inngest once it returns) and 'record' (one atomic
// RPC, idempotent on the event id). If the worker dies or the connection
// drops after 'fetch', Inngest re-runs only 'record' with the memoised
// result; if it dies mid-'record', the retry finds the first attempt's row
// by idempotency key instead of writing a second one. Changed content is
// staged as a capture for review -- nothing is published from here.
//
// source-refresh-scheduler: once a day, sends a check for every active
// source that is due under lib/sources/freshness.ts (overdue, and not
// attempted in the last 24 h). Bounded per run.

export const MAX_SCHEDULED_CHECKS_PER_RUN = 50;

export const sourceCheck = inngest.createFunction(
  {
    id: 'source-check',
    name: 'Check a registered source for changes',
    triggers: [{ event: 'source/check.requested' }],
    idempotency: 'event.data.sourceId + "-" + event.data.requestKey',
    concurrency: [{ limit: 1, key: 'event.data.sourceId' }, { limit: 3 }],
    retries: 2,
  },
  async ({ event, step }) => {
    if (!isSourceRegistryEnabled()) return { skipped: 'flag_off' as const };
    const { sourceId, requestedBy } = event.data as PermitEventPayloads['source/check.requested'];

    const source = await step.run('load-source', async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from('jurisdiction_sources')
        .select('id, url, archived_at')
        .eq('id', sourceId)
        .maybeSingle();
      if (error) throw new Error(`Could not load source: ${error.message}`);
      if (!data || data.archived_at) return null;
      const { data: lastOk } = await supabase
        .from('source_check_runs')
        .select('etag, last_modified')
        .eq('source_id', sourceId)
        .in('outcome', ['changed', 'unchanged', 'not_modified'])
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { url: data.url as string, etag: lastOk?.etag ?? null, lastModified: lastOk?.last_modified ?? null };
    });
    if (!source) return { skipped: 'source_missing_or_archived' as const };

    const checked = await step.run('fetch', () => checkSource(source.url, { etag: source.etag, lastModified: source.lastModified }));

    return step.run('record', async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc('record_source_check', {
        p_source_id: sourceId,
        p_idempotency_key: `source-check:${event.id}`,
        p_result: checked.result,
        p_http_status: checked.httpStatus,
        p_final_url: checked.finalUrl,
        p_content_type: checked.result === 'not_modified' ? null : checked.contentType,
        p_byte_length: checked.result === 'not_modified' ? null : checked.byteLength,
        p_etag: checked.result === 'fetched' || checked.result === 'not_modified' ? checked.etag : null,
        p_last_modified: checked.result === 'fetched' || checked.result === 'not_modified' ? checked.lastModified : null,
        p_error_code: checked.result === 'failed' || checked.result === 'blocked' ? checked.errorCode : null,
        p_error_message: checked.result === 'failed' || checked.result === 'blocked' ? checked.errorMessage : null,
        p_requested_by: requestedBy,
        p_capture: checked.result === 'fetched' ? checked.capture : null,
      });
      if (error) throw new Error(`record_source_check failed: ${error.message}`);
      const row = (data as { check_run_id: string; outcome: string; capture_id: string | null }[])[0];
      return { checkRunId: row.check_run_id, outcome: row.outcome, captureId: row.capture_id };
    });
  }
);

export const sourceRefreshScheduler = inngest.createFunction(
  {
    id: 'source-refresh-scheduler',
    name: 'Schedule due source checks',
    triggers: [{ cron: 'TZ=America/Edmonton 0 4 * * *' }],
    retries: 1,
  },
  async ({ step }) => {
    if (!isSourceRegistryEnabled()) return { skipped: 'flag_off' as const };

    const due = await step.run('find-due-sources', async () => {
      // One row per active source (source_check_status, 20260806000094).
      const { data, error } = await createServiceClient().rpc('source_check_status');
      if (error) throw new Error(`Could not read source status: ${error.message}`);
      return ((data ?? []) as { source_id: string; source_type: SourceType; last_attempt_at: string | null; last_success_at: string | null }[])
        .filter((s) => isCheckDue(s.source_type, s.last_success_at, s.last_attempt_at))
        .sort((a, b) => (a.last_success_at ?? '').localeCompare(b.last_success_at ?? ''))
        .slice(0, MAX_SCHEDULED_CHECKS_PER_RUN)
        .map((s) => s.source_id);
    });

    if (due.length > 0) {
      const requestKey = new Date().toISOString().slice(0, 10);
      await step.sendEvent(
        'request-checks',
        due.map((sourceId) => ({ name: 'source/check.requested' as const, data: { sourceId, requestKey, requestedBy: null } }))
      );
    }
    return { requested: due.length };
  }
);
