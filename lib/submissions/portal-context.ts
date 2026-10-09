import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFieldResolutionContext, type FieldResolutionContext } from '@/lib/pdf/resolve-fields';

// The field-resolution context for one application, read with the member's
// own session (RLS scopes every row to their org) -- the same inputs
// lib/inngest/functions/generate-pdf.ts reads with the service role, for the
// portal answer sheet on the submission panel. The applicant email falls back
// to the signed-in member's own address (generate-pdf falls back to the org
// owner's, which needs the admin API).
export async function loadFieldResolutionContext(
  supabase: SupabaseClient,
  input: { orgId: string; applicationId: string; userEmail: string | null }
): Promise<FieldResolutionContext | null> {
  const { data: application } = await supabase
    .from('permit_applications')
    .select('contractor_id, project_title, project_address, estimated_job_value_cents')
    .eq('id', input.applicationId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (!application) return null;

  const [{ data: extraction }, { data: contractor }, { data: taxProfile }] = await Promise.all([
    supabase
      .from('extractions')
      .select('parsed_data')
      .eq('application_id', input.applicationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('contractors')
      .select('company_name, primary_license_number, license_province_code')
      .eq('id', application.contractor_id)
      .maybeSingle(),
    supabase.from('org_tax_profiles').select('invoice_contact_email').eq('org_id', input.orgId).maybeSingle(),
  ]);

  return buildFieldResolutionContext({
    parsedData: (extraction?.parsed_data ?? null) as Record<string, unknown> | null,
    estimatedJobValueCents: application.estimated_job_value_cents as number | null,
    projectTitle: application.project_title,
    projectAddress: application.project_address,
    orgContactEmail: taxProfile?.invoice_contact_email || input.userEmail,
    contractor: contractor ?? null,
  });
}
