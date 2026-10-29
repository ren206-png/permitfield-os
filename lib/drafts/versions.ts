// Gate 6.5: the rules for writing a new version of an application draft
// (application_draft_versions, migration 20260806000097; master prompt
// §12/§14 "preserve human edits unless the user approves a replacement",
// optimistic concurrency).
//
// - A person saves on top of the version they were looking at. If someone
//   saved in between, the save is refused as stale (and the database's
//   unique (thread_id, version) refuses it again if two saves race).
// - An AI draft is written only when there is no version yet or the latest
//   one is itself AI-generated. Over a human edit it is returned as a
//   suggestion instead; the person decides what goes into their next save.

export interface DraftVersionRow {
  thread_id: string;
  version: number;
  origin: 'ai_generated' | 'human_edited';
  body: string;
  created_at: string;
}

export function latestVersion(rows: readonly DraftVersionRow[]): DraftVersionRow | null {
  return rows.reduce<DraftVersionRow | null>((best, r) => (!best || r.version > best.version ? r : best), null);
}

export type VersionSlot = { version: number; basedOn: number | null };

export type HumanSaveDecision = ({ ok: true } & VersionSlot) | { ok: false; reason: 'stale_base' };

export function decideHumanSave(latest: DraftVersionRow | null, baseVersion: number | null): HumanSaveDecision {
  const current = latest?.version ?? null;
  if (current !== baseVersion) return { ok: false, reason: 'stale_base' };
  return { ok: true, version: (current ?? 0) + 1, basedOn: current };
}

export type AiWriteDecision = ({ write: true } & VersionSlot) | { write: false; reason: 'human_edits_present' };

export function decideAiWrite(latest: DraftVersionRow | null): AiWriteDecision {
  if (latest?.origin === 'human_edited') return { write: false, reason: 'human_edits_present' };
  return { write: true, version: (latest?.version ?? 0) + 1, basedOn: latest?.version ?? null };
}

export const DRAFT_EXPORT_HEADER = (kind: string, version: number) =>
  `DRAFT -- ${kind}, version ${version}. Prepared in PermitField OS; not submitted, not signed, and not an approval.\n\n`;
