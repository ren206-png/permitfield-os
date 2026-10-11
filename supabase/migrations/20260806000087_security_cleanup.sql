-- Security clean-up from the 2026-10-11 review.
--
-- 1. record_uploaded_signed_form(): the path check only compared the first
--    74 characters ('<org>/<application>/'), so a path with '../' segments
--    passed and was stored; the storage URL later resolves those segments
--    outside the application's folder. The function is callable directly by
--    any signed-in user over /rest/v1/rpc, so the app-side check alone is not
--    enough. Reject '..' segments, empty segments and backslashes.
--
-- 2. Pin search_path on every remaining public function that has none (the
--    Supabase advisor's function_search_path_mutable warning). All of them
--    are SECURITY INVOKER; pinning stops a caller-controlled search_path from
--    changing which tables/operators they resolve. 'extensions' stays on the
--    path for the pgvector operators. Extension-owned functions are skipped.

create or replace function public.record_uploaded_signed_form(
  p_application_id uuid,
  p_permit_type_filing_id uuid,
  p_storage_path text,
  p_filename text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_app permit_applications%rowtype;
  v_document_id uuid;
  v_role org_role;
begin
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null or not can_submit_filings(v_app.org_id) then
    raise exception 'not_authorized: only owners and permit managers can upload a signed form' using errcode = '42501';
  end if;
  if v_app.status not in ('documents_generated', 'submitted') then
    raise exception 'not_ready: generate the filled forms first';
  end if;
  if not exists (
    select 1 from permit_type_filings where id = p_permit_type_filing_id and permit_type_id = v_app.permit_type_id
  ) then
    raise exception 'invalid_filing: that filing does not belong to this application';
  end if;
  if p_storage_path is null
    or left(p_storage_path, 74) <> v_app.org_id::text || '/' || v_app.id::text || '/'
    or p_storage_path ~ '(^|/)\.\.(/|$)'
    or position('//' in p_storage_path) > 0
    or position(E'\\' in p_storage_path) > 0 then
    raise exception 'invalid_path: the file must be stored under this application';
  end if;
  if p_filename is distinct from p_permit_type_filing_id::text || '-signed-upload.pdf' then
    raise exception 'invalid_filename';
  end if;

  insert into generated_documents
    (application_id, permit_type_filing_id, storage_path, original_filename, fill_method, created_at)
  values
    (v_app.id, p_permit_type_filing_id, p_storage_path, p_filename, 'uploaded', clock_timestamp())
  returning id into v_document_id;

  -- A signature request would now sign an older copy; withdraw it.
  update permit_signature_requests
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where application_id = v_app.id and permit_type_filing_id = p_permit_type_filing_id and status = 'pending';

  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();
  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  values (v_app.org_id, auth.uid(), v_role, 'generated_document.signed_copy_uploaded', 'generated_document', v_document_id,
          jsonb_build_object('permit_type_filing_id', p_permit_type_filing_id));

  return v_document_id;
end;
$function$;

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proconfig is null
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', v_fn);
  end loop;
end $$;
