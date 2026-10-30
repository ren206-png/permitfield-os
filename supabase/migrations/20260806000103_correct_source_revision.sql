-- Correcting a published source revision's details (dates, title, issuing
-- body, use rights). Revisions are immutable, so a typo -- on 2026-10-30
-- Calgary's 2026 fee schedule was published effective "2926-01-01", which
-- keeps it out of search_source_evidence for any real date -- could only be
-- fixed by waiting for the city to change the document.
--
-- correct_source_revision() publishes a new revision of the same source with
-- the SAME captured text (content hash, snapshot path and chunks copied) and
-- the corrected details, linked by corrects_revision_id and
-- supersedes_revision_id, with a 'verified' review whose notes say what was
-- corrected. search_source_evidence already takes the newest revision whose
-- window covers the date, so the correction takes over. The original row is
-- untouched but retired: it gets a 'stale' review ("superseded by the
-- correction"), so where a correction narrows the window the original can't
-- answer for the dates it got wrong. Anything that cites the original (a
-- fee schedule version) keeps citing it -- the text is identical.
--
-- unique (source_id, content_sha256) stays for ordinary revisions (one
-- revision per distinct text); only corrections may repeat a text.
--
-- Rollback (reverse order; valid while no correction rows exist):
--   drop function if exists correct_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text);
--   drop index if exists source_revisions_source_content_uniq;
--   alter table source_revisions add constraint source_revisions_source_id_content_sha256_key unique (source_id, content_sha256);
--   alter table source_revisions drop column corrects_revision_id;

alter table source_revisions
  add column corrects_revision_id uuid references source_revisions(id),
  add constraint source_revisions_not_self_correcting check (corrects_revision_id <> id);

alter table source_revisions drop constraint source_revisions_source_id_content_sha256_key;
create unique index source_revisions_source_content_uniq
  on source_revisions (source_id, content_sha256) where corrects_revision_id is null;

create function correct_source_revision(
  p_revision_id uuid,
  p_title text,
  p_issuing_body text,
  p_published_on date,
  p_effective_from date,
  p_effective_to date,
  p_access_scope source_access_scope,
  p_licence_notes text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old source_revisions%rowtype;
  v_new_id uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can correct a source revision' using errcode = 'insufficient_privilege';
  end if;
  if p_notes is null or length(btrim(p_notes)) = 0 then
    raise exception 'say what is being corrected' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_old from source_revisions where id = p_revision_id;
  if not found then
    raise exception 'revision % not found', p_revision_id using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('source_check:' || v_old.source_id::text));

  if v_old.revision_number <> (select max(revision_number) from source_revisions where source_id = v_old.source_id) then
    raise exception 'only the newest revision of a source can be corrected' using errcode = 'check_violation';
  end if;
  if not source_revision_is_published(v_old.id) then
    raise exception 'revision % is not published, so there is nothing to correct', p_revision_id using errcode = 'check_violation';
  end if;

  insert into source_revisions (source_id, revision_number, content_sha256, snapshot_storage_path, title, issuing_body,
    published_on, effective_from, effective_to, retrieved_at, access_scope, licence_notes,
    supersedes_revision_id, corrects_revision_id, created_by)
  values (v_old.source_id, v_old.revision_number + 1, v_old.content_sha256, v_old.snapshot_storage_path, p_title, p_issuing_body,
    p_published_on, p_effective_from, p_effective_to, v_old.retrieved_at, p_access_scope, p_licence_notes,
    v_old.id, v_old.id, v_actor)
  returning id into v_new_id;

  insert into source_revision_chunks (source_revision_id, chunk_index, locator, content)
  select v_new_id, chunk_index, locator, content from source_revision_chunks where source_revision_id = v_old.id;

  insert into source_revision_reviews (source_revision_id, status, notes, reviewed_by, reviewed_at)
  values (v_new_id, 'verified', left('Correction of revision ' || v_old.revision_number || ': ' || btrim(p_notes), 2000), v_actor, clock_timestamp());

  -- Retire the original: its details are known to be wrong.
  insert into source_revision_reviews (source_revision_id, status, notes, reviewed_by, reviewed_at)
  values (v_old.id, 'stale', 'Superseded by correction (revision ' || (v_old.revision_number + 1) || ')', v_actor, clock_timestamp());

  return v_new_id;
end;
$$;

revoke execute on function correct_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text) from public, anon;
grant execute on function correct_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text) to authenticated;
