// Gate 6.6: the contract every future submission/status connector must
// meet (master prompt §14). INTERFACES ONLY in this release: no connector
// is implemented or enabled, and PermitField never submits to an authority
// portal on its own. What exists today is user-directed: the email
// submission (lib/submissions) and "record a submission made elsewhere"
// (filing_submissions.method = 'portal' | 'in_person').
//
// The rules a connector must follow, encoded in reduceSubmissionAttempt():
//   prepared -> attempted -> acknowledged -> authority_accepted | authority_rejected
// - Every attempt carries an idempotency key and the immutable package
//   (submission_packages.manifest_sha256) it sends; a retry re-sends the
//   same package with the same key, never a new one.
// - A timeout or lost response is `unknown`, NOT failed: the attempt may
//   have landed. Before any retry the connector must reconcile (ask the
//   authority) -- the reducer refuses a retry from `unknown`.
// - No receipt, no claimed submission: `acknowledged` needs a receipt id.
// - Callbacks are authenticated by the connector, deduplicated by event id
//   and ordered by their own timestamp; a callback older than the last
//   applied one, or that would move the attempt backwards, is ignored.
// - Status changes reach the application only through
//   record_connector_status_event (20260806000098), which in this release
//   records but never applies them.

export type AttemptState = 'prepared' | 'attempted' | 'unknown' | 'acknowledged' | 'authority_accepted' | 'authority_rejected' | 'failed';

export interface SubmissionAttempt {
  idempotencyKey: string;
  packageSha256: string;
  state: AttemptState;
  receiptId: string | null;
  lastEventAt: string | null;
  seenEventIds: string[];
  history: { state: AttemptState; at: string; eventId: string | null }[];
}

export type AttemptEvent =
  | { type: 'send_started'; at: string }
  | { type: 'send_timed_out'; at: string }
  | { type: 'send_failed_before_delivery'; at: string; reason: string }
  | { type: 'retry'; at: string; idempotencyKey: string; packageSha256: string }
  | { type: 'reconciled'; at: string; found: false }
  | { type: 'reconciled'; at: string; found: true; receiptId: string }
  | { type: 'callback'; eventId: string; at: string; status: 'received' | 'accepted' | 'rejected'; receiptId: string | null };

export type ReduceResult = { ok: true; attempt: SubmissionAttempt; ignored?: 'duplicate' | 'out_of_order' | 'backwards' } | { ok: false; error: string };

const ORDER: Record<AttemptState, number> = {
  prepared: 0,
  attempted: 1,
  unknown: 1,
  failed: 1,
  acknowledged: 2,
  authority_accepted: 3,
  authority_rejected: 3,
};

export function newAttempt(idempotencyKey: string, packageSha256: string): SubmissionAttempt {
  if (!/^[0-9a-f]{64}$/.test(packageSha256)) throw new Error('package hash must be a sha256');
  if (!idempotencyKey) throw new Error('idempotency key required');
  return { idempotencyKey, packageSha256, state: 'prepared', receiptId: null, lastEventAt: null, seenEventIds: [], history: [] };
}

function move(a: SubmissionAttempt, state: AttemptState, at: string, eventId: string | null, receiptId?: string | null): SubmissionAttempt {
  return {
    ...a,
    state,
    receiptId: receiptId === undefined ? a.receiptId : receiptId,
    lastEventAt: at,
    seenEventIds: eventId ? [...a.seenEventIds, eventId] : a.seenEventIds,
    history: [...a.history, { state, at, eventId }],
  };
}

export function reduceSubmissionAttempt(a: SubmissionAttempt, e: AttemptEvent): ReduceResult {
  switch (e.type) {
    case 'send_started':
      return a.state === 'prepared' ? { ok: true, attempt: move(a, 'attempted', e.at, null) } : { ok: false, error: `cannot send from ${a.state}` };
    case 'send_timed_out':
      // The authority may have received it: unknown, never failed.
      return a.state === 'attempted' ? { ok: true, attempt: move(a, 'unknown', e.at, null) } : { ok: false, error: `no send in flight (${a.state})` };
    case 'send_failed_before_delivery':
      return a.state === 'attempted' ? { ok: true, attempt: move(a, 'failed', e.at, null) } : { ok: false, error: `no send in flight (${a.state})` };
    case 'retry':
      if (a.state === 'unknown') return { ok: false, error: 'reconcile with the authority before retrying an attempt whose outcome is unknown' };
      if (a.state !== 'failed') return { ok: false, error: `nothing to retry (${a.state})` };
      if (e.idempotencyKey !== a.idempotencyKey || e.packageSha256 !== a.packageSha256) {
        return { ok: false, error: 'a retry must re-send the same package with the same idempotency key' };
      }
      return { ok: true, attempt: move(a, 'attempted', e.at, null) };
    case 'reconciled':
      if (a.state !== 'unknown') return { ok: false, error: `nothing to reconcile (${a.state})` };
      return e.found ? { ok: true, attempt: move(a, 'acknowledged', e.at, null, e.receiptId) } : { ok: true, attempt: move(a, 'failed', e.at, null) };
    case 'callback': {
      if (a.seenEventIds.includes(e.eventId)) return { ok: true, attempt: a, ignored: 'duplicate' };
      if (a.lastEventAt !== null && e.at < a.lastEventAt) return { ok: true, attempt: { ...a, seenEventIds: [...a.seenEventIds, e.eventId] }, ignored: 'out_of_order' };
      const target: AttemptState = e.status === 'received' ? 'acknowledged' : e.status === 'accepted' ? 'authority_accepted' : 'authority_rejected';
      if (ORDER[target] < ORDER[a.state] || (ORDER[a.state] === 3 && target !== a.state)) {
        return { ok: true, attempt: { ...a, seenEventIds: [...a.seenEventIds, e.eventId] }, ignored: 'backwards' };
      }
      const receipt = e.receiptId ?? a.receiptId;
      if (target === 'acknowledged' && !receipt) return { ok: false, error: 'no receipt, no acknowledged submission' };
      return { ok: true, attempt: move(a, target, e.at, e.eventId, receipt) };
    }
  }
}

// The connector interface itself. Nothing implements it in this release.
export interface SubmissionConnector {
  readonly name: string;
  // True only where a documented, authorized integration exists (§14).
  readonly authorized: boolean;
  submit(input: { idempotencyKey: string; packageSha256: string; payload: Uint8Array }, signal: AbortSignal): Promise<AttemptEvent[]>;
  reconcile(input: { idempotencyKey: string }, signal: AbortSignal): Promise<Extract<AttemptEvent, { type: 'reconciled' }>>;
  verifyCallback(headers: Record<string, string>, body: string): { ok: true; event: Extract<AttemptEvent, { type: 'callback' }> } | { ok: false };
}
