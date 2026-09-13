// Test-only helper: a hand-rolled, minimal "fake" Supabase client double,
// used by this directory's *.test.ts files (and lib/pdf/estimate-pdf.test.ts/
// invoice-pdf.test.ts have no need for it at all, since those modules take
// plain data, not a Supabase client).
//
// No test file anywhere else in this codebase mocks Supabase (see
// lib/entitlements/index.test.ts's own header comment) -- there is no
// existing convention to follow, so this is a fresh, deliberately narrow
// design: each service function in this directory touches a given table (or
// calls a given RPC) at most once per invocation, so a per-table/per-RPC
// FIFO queue of canned `{ data, error }` responses is sufficient to drive
// every test in this module without a general-purpose query-simulating
// engine. This file does NOT end in `.test.ts`, so vitest's
// `include: ['**/*.test.ts']` (vitest.config.mts) never tries to run it as a
// test suite itself.
//
// Deliberately kept in this one shared file (rather than re-implemented
// per-test-file, which the initial plan for this build considered) because
// every test file in this directory needs the exact same chain shape --
// duplicating this chain-builder five times across estimates.test.ts/
// invoices.test.ts/payments.test.ts/estimate-acceptances.test.ts/
// csv-export.test.ts would risk the copies silently drifting, the same
// "shared, not duplicated" reasoning lib/quotes-payments/tax-result.ts's own
// header comment gives for why estimates.ts/invoices.ts share one
// tax-outcome path.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeResponse = { data: any; error: { message: string } | null };

export interface FakeCallLogEntry {
  type: 'from' | 'rpc';
  table?: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  methodCalls?: { method: string; args: any[] }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

class FakeQueryChain implements PromiseLike<FakeResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private methodCalls: { method: string; args: any[] }[] = [];

  constructor(
    private readonly table: string,
    private readonly client: FakeSupabaseClient
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private record(method: string, args: any[]): this {
    this.methodCalls.push({ method, args });
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select(...args: any[]): this {
    return this.record('select', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert(...args: any[]): this {
    return this.record('insert', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(...args: any[]): this {
    return this.record('update', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete(...args: any[]): this {
    return this.record('delete', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq(...args: any[]): this {
    return this.record('eq', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order(...args: any[]): this {
    return this.record('order', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gte(...args: any[]): this {
    return this.record('gte', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lt(...args: any[]): this {
    return this.record('lt', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lte(...args: any[]): this {
    return this.record('lte', args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  not(...args: any[]): this {
    return this.record('not', args);
  }
  single(): this {
    return this.record('single', []);
  }
  maybeSingle(): this {
    return this.record('maybeSingle', []);
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.client.callLog.push({ type: 'from', table: this.table, methodCalls: this.methodCalls });
    const response = this.client.nextTableResponse(this.table);
    return Promise.resolve(response).then(onfulfilled, onrejected);
  }
}

/**
 * Minimal fake standing in for `SupabaseClient<any>`. `tableResponses`/
 * `rpcResponses` are per-name FIFO queues -- provide one entry per
 * `.from(table)`/`.rpc(name)` call the function under test is expected to
 * make, in call order. `audit_logs` gets an implicit infinite default
 * success response if no queue is provided for it, since almost every
 * happy-path test needs one and repeating `{ data: { id: '...' }, error:
 * null }` in every single test file would be pure noise.
 */
export class FakeSupabaseClient {
  callLog: FakeCallLogEntry[] = [];

  constructor(
    private readonly tableResponses: Record<string, FakeResponse[]> = {},
    private readonly rpcResponses: Record<string, FakeResponse[]> = {}
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any {
    return new FakeQueryChain(table, this);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rpc(name: string, params?: any): Promise<FakeResponse> {
    this.callLog.push({ type: 'rpc', name, params });
    const queue = this.rpcResponses[name];
    if (!queue || queue.length === 0) {
      throw new Error(`FakeSupabaseClient: no fake rpc response queued for "${name}".`);
    }
    return queue.shift() as FakeResponse;
  }

  nextTableResponse(table: string): FakeResponse {
    const queue = this.tableResponses[table];
    if (queue && queue.length > 0) {
      return queue.shift() as FakeResponse;
    }
    if ((!queue || queue.length === 0) && table === 'audit_logs') {
      return { data: { id: 'fake-audit-log-id' }, error: null };
    }
    throw new Error(`FakeSupabaseClient: no fake response queued for table "${table}".`);
  }
}

export function ok<T>(data: T): FakeResponse {
  return { data, error: null };
}

export function dbError(message: string): FakeResponse {
  return { data: null, error: { message } };
}
