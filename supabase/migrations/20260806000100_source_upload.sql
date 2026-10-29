-- Source registry: an admin can upload a copy of an official document when
-- the automated check cannot fetch it. vancouver.ca sits behind a bot
-- challenge that refuses every automated request (even robots.txt, HTTP 403
-- on 2026-10-29), so no Vancouver source could ever be captured, and no
-- Vancouver fee schedule published (publish_fee_schedule_version, 097,
-- needs a published source revision).
--
-- An upload goes through the same pipeline as a fetch: the app extracts the
-- text with the same loaders (lib/sources/loaders.ts), and this function
-- stages it as a capture -- or reports it unchanged -- exactly as
-- record_source_check does. Nothing is published here; the admin reviews
-- and publishes the capture as before. The check history records that the
-- copy was uploaded (method, file name, who), so the provenance of every
-- revision stays visible. An upload counts as a successful check for
-- freshness: a person confirmed the official text that day.
--
-- Rollback (reverse order; valid while no row has method = 'uploaded'):
--   drop function if exists record_source_upload(uuid, text, text, integer, jsonb);
--   alter table source_check_runs drop constraint source_check_runs_upload_shape,
--     drop column uploaded_file_name, drop column method;
--   drop type if exists source_check_method;

create type source_check_method as enum ('fetched', 'uploaded');

alter table source_check_runs
  add column method source_check_method not null default 'fetched',
  add column uploaded_file_name text check (uploaded_file_name is null or length(btrim(uploaded_file_name)) between 1 and 255),
  add constraint source_check_runs_upload_shape check (
    (method = 'uploaded') = (uploaded_file_name is not null)
    and (method <> 'uploaded' or (requested_by is not null and outcome in ('changed', 'unchanged')))
  );

-- Platform admins only, acting as themselves (auth.uid()). The capture's
-- shape is validated by the app (lib/sources/capture.ts, Zod) before the
-- call; the table CHECKs and the cast on publication guard it again.
create function record_source_upload(
  p_source_id uuid,
  p_file_name text,
  p_content_type text,
  p_byte_length integer,
  p_capture jsonb
)
returns table (check_run_id uuid, outcome source_check_outcome, capture_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor uuid := auth.uid();
  v_sha text;
  v_outcome source_check_outcome;
  v_capture_id uuid;
  v_last_capture source_captures%rowtype;
  v_run_id uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can upload a source copy' using errcode = 'insufficient_privilege';
  end if;
  if p_capture is null or jsonb_typeof(p_capture) <> 'object' then
    raise exception 'an upload needs a capture' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtext('source_check:' || p_source_id::text));

  if not exists (select 1 from jurisdiction_sources where id = p_source_id and archived_at is null) then
    raise exception 'source % not found or archived', p_source_id using errcode = 'no_data_found';
  end if;

  -- Same change detection as record_source_check.
  v_sha := p_capture->>'content_sha256';
  select * into v_last_capture from source_captures
    where source_id = p_source_id order by captured_at desc limit 1;

  if found and v_last_capture.content_sha256 = v_sha then
    v_outcome := 'unchanged';
    v_capture_id := v_last_capture.id;
  elsif not found and exists (
    select 1 from source_revisions sr
    where sr.source_id = p_source_id and sr.content_sha256 = v_sha
      and sr.revision_number = (select max(revision_number) from source_revisions where source_id = p_source_id)
  ) then
    v_outcome := 'unchanged';
  else
    insert into source_captures (source_id, content_sha256, content_type, loader, loader_version, text_content, chunks, captured_at)
    values (p_source_id, v_sha, coalesce(p_content_type, 'application/octet-stream'),
            p_capture->>'loader', p_capture->>'loader_version', p_capture->>'text', p_capture->'chunks', clock_timestamp())
    returning id into v_capture_id;
    v_outcome := 'changed';
  end if;

  insert into source_check_runs (source_id, idempotency_key, outcome, content_type, byte_length, content_sha256,
    capture_id, requested_by, method, uploaded_file_name, checked_at)
  values (p_source_id, 'upload:' || gen_random_uuid()::text, v_outcome, p_content_type, p_byte_length, v_sha,
    v_capture_id, v_actor, 'uploaded', p_file_name, clock_timestamp())
  returning id into v_run_id;

  return query select v_run_id, v_outcome, v_capture_id;
end;
$$;

revoke execute on function record_source_upload(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function record_source_upload(uuid, text, text, integer, jsonb) to authenticated;
