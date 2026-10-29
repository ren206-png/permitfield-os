import { describe, expect, it } from 'vitest';
import { newAttempt, reduceSubmissionAttempt, type AttemptEvent, type SubmissionAttempt } from './contract';

// Gate 6.6 exit evidence (master prompt §17 N.6 state-machine tests; §18
// case 7: duplicate/out-of-order callbacks, unknown outcomes, reconciliation
// before retry).

const HASH = 'a'.repeat(64);
const run = (events: AttemptEvent[], start: SubmissionAttempt = newAttempt('key-1', HASH)) => {
  let attempt = start;
  const ignored: string[] = [];
  for (const e of events) {
    const r = reduceSubmissionAttempt(attempt, e);
    if (!r.ok) throw new Error(r.error);
    if (r.ignored) ignored.push(r.ignored);
    attempt = r.attempt;
  }
  return { attempt, ignored };
};

describe('submission attempt state machine', () => {
  it('prepared -> attempted -> acknowledged (with receipt) -> accepted', () => {
    const { attempt } = run([
      { type: 'send_started', at: '2026-11-01T10:00:00Z' },
      { type: 'callback', eventId: 'e1', at: '2026-11-01T10:00:05Z', status: 'received', receiptId: 'R-77' },
      { type: 'callback', eventId: 'e2', at: '2026-11-08T09:00:00Z', status: 'accepted', receiptId: null },
    ]);
    expect(attempt).toMatchObject({ state: 'authority_accepted', receiptId: 'R-77' });
  });

  it('a timeout is unknown, never failed, and a retry is refused until reconciled', () => {
    const { attempt } = run([
      { type: 'send_started', at: '2026-11-01T10:00:00Z' },
      { type: 'send_timed_out', at: '2026-11-01T10:01:00Z' },
    ]);
    expect(attempt.state).toBe('unknown');
    expect(reduceSubmissionAttempt(attempt, { type: 'retry', at: '2026-11-01T10:02:00Z', idempotencyKey: 'key-1', packageSha256: HASH })).toEqual({
      ok: false,
      error: 'reconcile with the authority before retrying an attempt whose outcome is unknown',
    });
    const found = reduceSubmissionAttempt(attempt, { type: 'reconciled', at: '2026-11-01T10:05:00Z', found: true, receiptId: 'R-9' });
    expect(found.ok && found.attempt).toMatchObject({ state: 'acknowledged', receiptId: 'R-9' });
  });

  it('a retry after a confirmed failure must re-send the same package with the same key', () => {
    const failed = run([
      { type: 'send_started', at: '2026-11-01T10:00:00Z' },
      { type: 'send_failed_before_delivery', at: '2026-11-01T10:00:01Z', reason: 'DNS' },
    ]).attempt;
    expect(reduceSubmissionAttempt(failed, { type: 'retry', at: 't', idempotencyKey: 'key-2', packageSha256: HASH }).ok).toBe(false);
    expect(reduceSubmissionAttempt(failed, { type: 'retry', at: 't', idempotencyKey: 'key-1', packageSha256: 'b'.repeat(64) }).ok).toBe(false);
    const retried = reduceSubmissionAttempt(failed, { type: 'retry', at: '2026-11-01T10:10:00Z', idempotencyKey: 'key-1', packageSha256: HASH });
    expect(retried.ok && retried.attempt.state).toBe('attempted');
  });

  it('duplicate, out-of-order and backwards callbacks are ignored', () => {
    const { attempt, ignored } = run([
      { type: 'send_started', at: '2026-11-01T10:00:00Z' },
      { type: 'callback', eventId: 'e1', at: '2026-11-01T10:00:05Z', status: 'received', receiptId: 'R-1' },
      { type: 'callback', eventId: 'e2', at: '2026-11-09T09:00:00Z', status: 'rejected', receiptId: null },
      { type: 'callback', eventId: 'e2', at: '2026-11-09T09:00:00Z', status: 'rejected', receiptId: null },
      { type: 'callback', eventId: 'e0', at: '2026-11-01T09:59:00Z', status: 'received', receiptId: 'R-0' },
      { type: 'callback', eventId: 'e3', at: '2026-11-10T09:00:00Z', status: 'accepted', receiptId: null },
    ]);
    expect(attempt).toMatchObject({ state: 'authority_rejected', receiptId: 'R-1' });
    expect(ignored).toEqual(['duplicate', 'out_of_order', 'backwards']);
  });

  it('no receipt, no acknowledged submission', () => {
    const sent = run([{ type: 'send_started', at: '2026-11-01T10:00:00Z' }]).attempt;
    expect(reduceSubmissionAttempt(sent, { type: 'callback', eventId: 'e1', at: '2026-11-01T10:00:05Z', status: 'received', receiptId: null })).toEqual({
      ok: false,
      error: 'no receipt, no acknowledged submission',
    });
  });

  it('an attempt needs a real package hash and an idempotency key', () => {
    expect(() => newAttempt('k', 'not-a-hash')).toThrow();
    expect(() => newAttempt('', HASH)).toThrow();
  });
});
