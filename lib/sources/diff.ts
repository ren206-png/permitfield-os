// Gate 6.3: line diff between two captures of the same source, shown to the
// reviewer before publishing (master prompt §7 "diffs, review queues").
// Plain LCS over non-empty lines; bounded so a huge page can't stall a
// request -- past the bound the reviewer is told the diff was not computed
// rather than shown a partial one that looks complete.

// The LCS table is (lines+1)² 32-bit cells after trimming the common
// prefix/suffix, so 2000 lines bounds it at ~16 MB.
export const MAX_DIFF_LINES = 2000;

export type DiffOp = { op: 'same' | 'added' | 'removed'; line: string };

export type LineDiff =
  | { computed: true; ops: DiffOp[]; added: number; removed: number }
  | { computed: false; reason: 'too_large'; beforeLines: number; afterLines: number };

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function diffLines(before: string, after: string): LineDiff {
  const a = lines(before);
  const b = lines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return { computed: false, reason: 'too_large', beforeLines: a.length, afterLines: b.length };
  }

  // Trim the common prefix and suffix first; most revisions touch little.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // LCS table over the middle only.
  const n = midA.length;
  const m = midB.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = a.slice(0, start).map((line) => ({ op: 'same' as const, line }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ op: 'same', line: midA[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: 'removed', line: midA[i++] });
    } else {
      ops.push({ op: 'added', line: midB[j++] });
    }
  }
  while (i < n) ops.push({ op: 'removed', line: midA[i++] });
  while (j < m) ops.push({ op: 'added', line: midB[j++] });
  for (const line of a.slice(endA)) ops.push({ op: 'same', line });

  return {
    computed: true,
    ops,
    added: ops.filter((o) => o.op === 'added').length,
    removed: ops.filter((o) => o.op === 'removed').length,
  };
}

// Only the changed lines plus `context` unchanged lines around each change.
export function changedHunks(ops: readonly DiffOp[], context = 2): (DiffOp | { op: 'gap'; count: number })[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, idx) => {
    if (o.op === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: (DiffOp | { op: 'gap'; count: number })[] = [];
  let gap = 0;
  ops.forEach((o, idx) => {
    if (keep[idx]) {
      if (gap) out.push({ op: 'gap', count: gap });
      gap = 0;
      out.push(o);
    } else {
      gap++;
    }
  });
  if (gap) out.push({ op: 'gap', count: gap });
  return out;
}
