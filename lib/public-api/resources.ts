import { ALL_PERMIT_STATUSES } from '@/lib/permit-status/transitions';
import { PROJECT_STATUS_VALUES } from '@/lib/intake/schemas';
import { apiError, apiJson, type ApiContext } from './handler';
import { buildPage, isUuid, parsePageParams } from './pagination';

// Every query here runs on the service-role client with no RLS backstop,
// so each one MUST filter .eq('org_id', ctx.orgId). ctx.orgId comes only
// from the resolved API key (handler.ts).

const PROJECT_COLUMNS =
  'id, title, description, status, applicant_name, property_owner_name, client_id, property_id, contractor_id, archived_at, created_at, updated_at';

const APPLICATION_COLUMNS =
  'id, project_id, project_title, project_address, status, permit_status, permit_number, permit_type_id, contractor_id, decision_date, permit_expires_on, estimated_job_value_cents, currency_code, created_at, updated_at';

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export async function listProjects(ctx: ApiContext) {
  const parsed = parsePageParams(ctx.searchParams);
  if (!parsed.ok) {
    return apiError(400, 'invalid_request', parsed.error);
  }
  const { page } = parsed;

  let query = ctx.client
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page.offset, page.offset + page.limit);

  const status = ctx.searchParams.get('status');
  if (status !== null) {
    if (!isOneOf(PROJECT_STATUS_VALUES, status)) {
      return apiError(400, 'invalid_request', `status must be one of: ${PROJECT_STATUS_VALUES.join(', ')}.`);
    }
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`projects list failed: ${error.message}`);
  }
  return apiJson(buildPage(data ?? [], page));
}

export async function getProject(ctx: ApiContext, id: string) {
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Project not found.');
  }
  const { data, error } = await ctx.client
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('org_id', ctx.orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`project get failed: ${error.message}`);
  }
  if (!data) {
    return apiError(404, 'not_found', 'Project not found.');
  }
  return apiJson({ data });
}

export async function listApplications(ctx: ApiContext) {
  const parsed = parsePageParams(ctx.searchParams);
  if (!parsed.ok) {
    return apiError(400, 'invalid_request', parsed.error);
  }
  const { page } = parsed;

  let query = ctx.client
    .from('permit_applications')
    .select(APPLICATION_COLUMNS)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page.offset, page.offset + page.limit);

  const projectId = ctx.searchParams.get('project_id');
  if (projectId !== null) {
    if (!isUuid(projectId)) {
      return apiError(400, 'invalid_request', 'project_id must be a UUID.');
    }
    query = query.eq('project_id', projectId);
  }

  const permitStatus = ctx.searchParams.get('permit_status');
  if (permitStatus !== null) {
    if (!isOneOf(ALL_PERMIT_STATUSES, permitStatus)) {
      return apiError(400, 'invalid_request', `permit_status must be one of: ${ALL_PERMIT_STATUSES.join(', ')}.`);
    }
    query = query.eq('permit_status', permitStatus);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`applications list failed: ${error.message}`);
  }
  return apiJson(buildPage(data ?? [], page));
}

export async function getApplication(ctx: ApiContext, id: string) {
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Application not found.');
  }
  const { data, error } = await ctx.client
    .from('permit_applications')
    .select(APPLICATION_COLUMNS)
    .eq('org_id', ctx.orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`application get failed: ${error.message}`);
  }
  if (!data) {
    return apiError(404, 'not_found', 'Application not found.');
  }
  return apiJson({ data });
}
