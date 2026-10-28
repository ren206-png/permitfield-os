import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Gate 6.4: the one application a copilot conversation is about. Resolved
// once per question, server-side, with the signed-in user's own session --
// RLS decides whether the application exists for them. Every tool runs
// inside this scope; no tool accepts an org, project or application id from
// the model (master prompt §1.8, §12: "the model may request scope; it
// cannot assert ownership").

export interface CopilotScope {
  userId: string;
  orgId: string;
  projectId: string | null;
  applicationId: string;
  applicationTitle: string;
  permitTypeId: string;
  permitTypeTitle: string;
  jurisdictionId: string;
  jurisdictionName: string;
}

interface ApplicationRow {
  id: string;
  org_id: string;
  project_id: string | null;
  project_title: string;
  permit_type_id: string;
  permit_types:
    | { title: string; jurisdiction_id: string; jurisdictions: { municipality: string; province_code: string } | { municipality: string; province_code: string }[] | null }
    | { title: string; jurisdiction_id: string; jurisdictions: { municipality: string; province_code: string } | { municipality: string; province_code: string }[] | null }[]
    | null;
}

const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function resolveCopilotScope(supabase: SupabaseClient, userId: string, applicationId: string): Promise<CopilotScope | null> {
  if (!z.guid().safeParse(applicationId).success) return null;
  const { data, error } = await supabase
    .from('permit_applications')
    .select('id, org_id, project_id, project_title, permit_type_id, permit_types ( title, jurisdiction_id, jurisdictions ( municipality, province_code ) )')
    .eq('id', applicationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ApplicationRow;
  const permitType = first(row.permit_types);
  if (!permitType) return null;
  const jurisdiction = first(permitType.jurisdictions);
  return {
    userId,
    orgId: row.org_id,
    projectId: row.project_id,
    applicationId: row.id,
    applicationTitle: row.project_title,
    permitTypeId: row.permit_type_id,
    permitTypeTitle: permitType.title,
    jurisdictionId: permitType.jurisdiction_id,
    jurisdictionName: jurisdiction ? `${jurisdiction.municipality}, ${jurisdiction.province_code}` : 'unknown',
  };
}
