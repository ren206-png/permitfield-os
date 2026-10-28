import type { ResolvedFact } from './condition';

// Gate 6.2: turns the append-only project_facts ledger
// (20260806000092) into the one value per fact key the rule engine may use.
//
// Only a CONFIRMED fact counts. A proposed fact (e.g. read from a drawing by
// the AI) is "awaiting_confirmation" until a person confirms it, and a
// rejected one is ignored. A confirmed correction replaces the fact it
// supersedes; a proposed or rejected row never hides an older confirmed one.

export interface ProjectFactRow {
  id: string;
  fact_key: string;
  value: unknown;
  unit: string | null;
  state: 'proposed' | 'confirmed' | 'rejected';
  supersedes_fact_id: string | null;
  created_at: string;
}

export interface ResolvedFacts {
  facts: Map<string, ResolvedFact>;
  // Keys with a confirmed value AND a newer unconfirmed proposal to review.
  pendingProposals: string[];
}

export function resolveFacts(rows: readonly ProjectFactRow[]): ResolvedFacts {
  const supersededByConfirmed = new Set(
    rows.filter((r) => r.state === 'confirmed' && r.supersedes_fact_id).map((r) => r.supersedes_fact_id as string)
  );
  const byKey = new Map<string, ProjectFactRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.fact_key) ?? [];
    list.push(row);
    byKey.set(row.fact_key, list);
  }

  const facts = new Map<string, ResolvedFact>();
  const pendingProposals: string[] = [];
  const newestFirst = (a: ProjectFactRow, b: ProjectFactRow) =>
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

  for (const [key, list] of byKey) {
    const confirmed = list
      .filter((r) => r.state === 'confirmed' && !supersededByConfirmed.has(r.id))
      .sort(newestFirst)[0];
    const newestProposal = list.filter((r) => r.state === 'proposed').sort(newestFirst)[0];

    if (confirmed) {
      facts.set(key, { status: 'confirmed', factId: confirmed.id, value: confirmed.value, unit: confirmed.unit });
      if (newestProposal && newestProposal.created_at > confirmed.created_at) pendingProposals.push(key);
    } else if (newestProposal) {
      facts.set(key, { status: 'awaiting_confirmation' });
    }
    // Only rejected rows: the key stays absent, i.e. missing.
  }

  return { facts, pendingProposals: pendingProposals.sort() };
}
