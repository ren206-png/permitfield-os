import { createHash } from 'node:crypto';
import { stableStringify } from '@/lib/sources/rule-set-publish';

// Gate 6.6: the submission package manifest (master prompt §14: "form
// revision, attachment versions/hashes, fact snapshot, checklist snapshot,
// unresolved items, preparer/reviewer, timestamp"). Built here from rows the
// caller read with its own session; stored once in submission_packages with
// a sha256 of its canonical JSON, so the exact package a connector or a
// person sends can be pinned and compared later. A manifest is a record of
// what is being sent, not a submission and not an approval.

export const MANIFEST_SCHEMA = 'permitfield.package.v1';

export interface ManifestInput {
  application: { id: string; title: string; address: string; permitType: string; municipality: string; permitStatus: string | null };
  forms: { id: string; filingId: string; filename: string; fillMethod: string; createdAt: string; incompleteRequired: string[] }[];
  attachments: { id: string; filename: string; kind: string; sha256: string; byteSize: number; revision: number | null; uploadedAt: string }[];
  confirmedFacts: { key: string; value: unknown; unit: string | null; factId: string }[];
  factsAwaitingConfirmation: string[];
  checklist: { title: string; required: boolean; status: string }[];
  ruleCheck: { evaluatedAt: string; applicable: number; notApplicable: number; unknown: number } | null;
  feeEstimate: { status: string; totalMinor: number | null; currency: string | null; computedAt: string } | null;
  preparedBy: string;
  preparedAt: string;
}

export interface PackageManifest {
  schema: typeof MANIFEST_SCHEMA;
  status: 'draft';
  application: ManifestInput['application'];
  forms: ManifestInput['forms'];
  attachments: ManifestInput['attachments'];
  fact_snapshot: ManifestInput['confirmedFacts'];
  checklist_snapshot: ManifestInput['checklist'];
  rule_check: ManifestInput['ruleCheck'];
  fee_estimate: ManifestInput['feeEstimate'];
  unresolved: string[];
  prepared_by: string;
  prepared_at: string;
  note: string;
}

export function unresolvedItems(input: ManifestInput): string[] {
  const items: string[] = [];
  for (const c of input.checklist) if (c.required && c.status !== 'complete') items.push(`Checklist: ${c.title} (${c.status})`);
  for (const f of input.forms) for (const field of f.incompleteRequired) items.push(`Form ${f.filename}: required field "${field}" is empty`);
  if (input.forms.length === 0) items.push('No filled form is included');
  for (const key of input.factsAwaitingConfirmation) items.push(`Fact awaiting confirmation: ${key}`);
  if (!input.ruleCheck) items.push('Requirements check not run');
  else if (input.ruleCheck.unknown > 0) items.push(`Requirements check: ${input.ruleCheck.unknown} requirement(s) unknown`);
  if (!input.feeEstimate) items.push('Fee not estimated');
  else if (input.feeEstimate.status !== 'estimated') items.push(`Fee estimate: ${input.feeEstimate.status.replaceAll('_', ' ')}`);
  return items;
}

export function buildManifest(input: ManifestInput): { manifest: PackageManifest; sha256: string } {
  const manifest: PackageManifest = {
    schema: MANIFEST_SCHEMA,
    status: 'draft',
    application: input.application,
    forms: [...input.forms].sort((a, b) => a.id.localeCompare(b.id)),
    attachments: [...input.attachments].sort((a, b) => a.id.localeCompare(b.id)),
    fact_snapshot: [...input.confirmedFacts].sort((a, b) => a.key.localeCompare(b.key)),
    checklist_snapshot: input.checklist,
    rule_check: input.ruleCheck,
    fee_estimate: input.feeEstimate,
    unresolved: unresolvedItems(input),
    prepared_by: input.preparedBy,
    prepared_at: input.preparedAt,
    note: 'Draft package prepared in PermitField OS. Not a submission, not signed, and not a government decision.',
  };
  return { manifest, sha256: createHash('sha256').update(stableStringify(manifest), 'utf8').digest('hex') };
}
