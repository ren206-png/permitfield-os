import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { LocalTime } from '@/components/local-time';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { diffRuleSet, type SnapshotLike } from '@/lib/sources/rule-set-publish';
import { createServiceClient } from '@/lib/supabase/service-client';
import { RuleSetForm } from '../rule-set-form';

// One permit type's rule set (Gate 6.3): what changed in the verified
// requirements since the published version, and the form that publishes the
// next version. Conditions are pre-filled from the current version.

export default async function PermitTypeRuleSetPage({ params }: { params: Promise<{ permitTypeId: string }> }) {
  await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();
  const { permitTypeId } = await params;
  if (!z.guid().safeParse(permitTypeId).success) notFound();

  const supabase = createServiceClient();
  const [{ data: permitType }, requirements, current] = await Promise.all([
    supabase.from('permit_types').select('id, title, jurisdictions ( municipality, province_code )').eq('id', permitTypeId).maybeSingle(),
    supabase
      .from('permit_requirements')
      .select('id, title, description, applies_when, display_order')
      .eq('permit_type_id', permitTypeId)
      .eq('verification_status', 'verified')
      .is('archived_at', null)
      .order('display_order', { ascending: true, nullsFirst: false }),
    supabase
      .from('rule_set_versions')
      .select('id, version, notes, published_at')
      .eq('permit_type_id', permitTypeId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!permitType) notFound();
  if (requirements.error || current.error) throw new Error(`Could not load: ${(requirements.error ?? current.error)?.message}`);

  const { data: items, error: itemsError } = current.data
    ? await supabase.from('rule_set_version_items').select('permit_requirement_id, requirement_snapshot').eq('rule_set_version_id', current.data.id)
    : { data: [], error: null };
  if (itemsError) throw new Error(`Could not load rule set items: ${itemsError.message}`);

  const currentSnapshots = new Map<string, SnapshotLike>(
    (items ?? []).map((i) => [i.permit_requirement_id as string, i.requirement_snapshot as SnapshotLike])
  );
  const liveSnapshots = new Map<string, SnapshotLike>(
    (requirements.data ?? []).map((r) => [
      r.id,
      { title: r.title, description: r.description, applies_when_text: r.applies_when, condition: currentSnapshots.get(r.id)?.condition ?? null },
    ])
  );
  const changes = current.data ? diffRuleSet(currentSnapshots, liveSnapshots) : [];
  const j = Array.isArray(permitType.jurisdictions) ? permitType.jurisdictions[0] : permitType.jurisdictions;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/rule-sets" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Rule sets
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900">
          {j ? `${j.municipality ?? 'Province-wide'}, ${j.province_code} · ` : ''}
          {permitType.title}
        </h1>
        <p className="text-sm text-zinc-600">
          {current.data ? (
            <>
              Current: version {current.data.version}, published <LocalTime value={current.data.published_at} dateOnly />
              {current.data.notes ? ` (“${current.data.notes}”)` : ''}.
            </>
          ) : (
            'No rule set published yet.'
          )}
        </p>
      </div>

      {current.data && (
        <section className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <h2 className="font-semibold text-zinc-900">Changes since version {current.data.version}</h2>
          {changes.length === 0 ? (
            <p className="mt-1 text-zinc-600">The verified requirements match the published version.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {changes.map((c) => (
                <li key={`${c.kind}-${c.requirementId}`} className={c.kind === 'removed' ? 'text-rose-800' : c.kind === 'added' ? 'text-emerald-800' : 'text-amber-800'}>
                  {c.kind === 'added' ? 'New: ' : c.kind === 'removed' ? 'No longer verified or retired: ' : 'Changed: '}
                  {c.title}
                  {c.kind === 'changed' ? ` (${c.fields.join(', ').replace('applies_when', 'when it applies')})` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(requirements.data ?? []).length === 0 ? (
        <p className="text-sm text-zinc-500">
          No verified requirements. Verify them in <Link href={`/admin/requirements/${permitTypeId}`} className="underline">Requirements review</Link> first.
        </p>
      ) : (
        <RuleSetForm
          permitTypeId={permitTypeId}
          requirements={(requirements.data ?? []).map((r) => {
            const condition = currentSnapshots.get(r.id)?.condition;
            return {
              id: r.id,
              title: r.title,
              appliesWhen: r.applies_when,
              included: !current.data || currentSnapshots.has(r.id),
              conditionJson: condition ? JSON.stringify(condition, null, 2) : '',
            };
          })}
        />
      )}
    </div>
  );
}
