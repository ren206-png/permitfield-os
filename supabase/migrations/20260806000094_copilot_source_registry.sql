-- Gate 6, sub-phase 6.3: source refresh, staging, review and publication,
-- and full-text retrieval over published source revisions
-- (GATE_6_STATUS.md § 6.3; master prompt §7, §10, §11).
--
-- Flow:
--   1. A check (scheduled or "Check now") fetches a registered
--      jurisdiction_sources URL. record_source_check() appends a
--      source_check_runs row; content that differs from the last capture is
--      STAGED as a source_captures row (extracted text + chunks). A failed
--      fetch is recorded as failed -- it never retires anything.
--   2. A platform admin reviews the capture (diff against the previous one)
--      and either publishes it -- publish_source_revision() creates the
--      immutable source_revisions row (6.1), its source_revision_chunks and
--      a 'verified' review in one transaction -- or dismisses it.
--   3. search_source_evidence() searches only the newest revision per source
--      whose effective window covers the as-of date, and only if that
--      revision is published (its latest review is 'verified'). Withdrawing
--      a revision (a later 'disputed'/'stale' review) removes it from
--      retrieval without falling back to older text.
--   4. publish_rule_set_version() snapshots verified permit_requirements
--      into an immutable rule_set_versions version (6.1 tables) for the 6.2
--      engine.
--
-- Everything is additive. All four new tables are append-only. Writes go
-- only through the SECURITY DEFINER functions below: no table here grants
-- INSERT to authenticated or service_role. Publication functions check
-- is_platform_admin() from the caller's session; record_source_check() is
-- executable by service_role only (the Inngest job).
--
-- Rollback (reverse order; valid while no later object references these):
--   drop function if exists publish_rule_set_version(uuid, uuid, text, jsonb);
--   drop function if exists search_source_evidence(uuid, text, date, integer);
--   drop function if exists source_check_status();
--   drop function if exists dismiss_source_capture(uuid, text);
--   drop function if exists publish_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text);
--   drop function if exists record_source_check(uuid, text, text, integer, text, text, integer, text, text, text, text, uuid, jsonb);
--   drop function if exists source_revision_is_published(uuid);
--   drop table if exists source_revision_chunks, source_capture_decisions, source_check_runs, source_captures;
--   drop type if exists source_capture_decision, source_check_outcome;

create type source_check_outcome as enum (
  'changed',       -- new content, staged as a capture
  'unchanged',     -- same content as the last capture (or published revision)
  'not_modified',  -- server answered 304 to a conditional request
  'failed',        -- network/HTTP/parse failure; nothing is retired
  'blocked'        -- refused before fetching (URL guard, unsupported content)
);

create type source_capture_decision as enum ('published', 'dismissed');

-- ---------------------------------------------------------------------------
-- source_captures: staged, unreviewed content. Admin-only.
-- ---------------------------------------------------------------------------
create table source_captures (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references jurisdiction_sources(id) on delete restrict,
  -- sha256 of the normalised extracted text (not the raw bytes), so page
  -- chrome that changes on every request does not read as a new revision.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (length(btrim(content_type)) between 1 and 200),
  loader text not null check (loader in ('html', 'pdf', 'text')),
  loader_version text not null check (length(btrim(loader_version)) between 1 and 50),
  text_content text not null check (length(text_content) between 1 and 1000000),
  -- [{ "index": 0, "locator": "...", "content": "..." }, ...]; shape is
  -- validated by Zod before the insert and cast loudly on publication.
  chunks jsonb not null check (
    jsonb_typeof(chunks) = 'array' and jsonb_array_length(chunks) between 1 and 2000
  ),
  captured_at timestamptz not null default now()
);

create index source_captures_source_idx on source_captures (source_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- source_check_runs: one row per check attempt.
-- ---------------------------------------------------------------------------
create table source_check_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references jurisdiction_sources(id) on delete restrict,
  -- Supplied by the caller (the Inngest event id), so a replayed step
  -- returns the first result instead of recording a second check.
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  outcome source_check_outcome not null,
  http_status integer check (http_status between 100 and 599),
  final_url text,
  content_type text,
  byte_length integer check (byte_length >= 0),
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  etag text,
  last_modified text,
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  error_message text check (length(error_message) <= 2000),
  capture_id uuid references source_captures(id) on delete restrict,
  -- null for scheduled checks.
  requested_by uuid references auth.users(id),
  checked_at timestamptz not null default now(),
  constraint source_check_runs_failure_has_code check (
    outcome not in ('failed', 'blocked') or error_code is not null
  ),
  constraint source_check_runs_changed_has_capture check (
    outcome <> 'changed' or (capture_id is not null and content_sha256 is not null)
  )
);

create index source_check_runs_source_idx on source_check_runs (source_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- source_capture_decisions: at most one decision per capture.
-- ---------------------------------------------------------------------------
create table source_capture_decisions (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null unique references source_captures(id) on delete restrict,
  decision source_capture_decision not null,
  source_revision_id uuid references source_revisions(id) on delete restrict,
  notes text check (length(notes) <= 2000),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  constraint source_capture_decisions_published_has_revision check (
    (decision = 'published') = (source_revision_id is not null)
  )
);

create index source_capture_decisions_revision_idx on source_capture_decisions (source_revision_id);

-- ---------------------------------------------------------------------------
-- source_revision_chunks: the searchable text of a published revision.
-- ---------------------------------------------------------------------------
create table source_revision_chunks (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null references source_revisions(id) on delete restrict,
  chunk_index integer not null check (chunk_index >= 0),
  -- Human-readable position in the source ("Fees › Residential", "p. 4").
  locator text not null check (length(btrim(locator)) between 1 and 300),
  content text not null check (length(content) between 1 and 8000),
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (source_revision_id, chunk_index)
);

create index source_revision_chunks_tsv_idx on source_revision_chunks using gin (content_tsv);

-- ---------------------------------------------------------------------------
-- Published = the revision's latest review is 'verified'.
-- ---------------------------------------------------------------------------
create function source_revision_is_published(p_revision_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select r.status = 'verified'
    from source_revision_reviews r
    where r.source_revision_id = p_revision_id
    -- On an exact tie a withdrawal outranks a verification (false < true).
    order by r.reviewed_at desc, (r.status = 'verified') asc
    limit 1
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- RLS, append-only, grants
-- ---------------------------------------------------------------------------
alter table source_captures enable row level security;
alter table source_check_runs enable row level security;
alter table source_capture_decisions enable row level security;
alter table source_revision_chunks enable row level security;

-- Staged content has not been reviewed: platform admins only.
create policy source_captures_select on source_captures
  for select to authenticated using (is_platform_admin());
create policy source_capture_decisions_select on source_capture_decisions
  for select to authenticated using (is_platform_admin());
-- Check history is public-URL metadata; readable so freshness can be shown.
create policy source_check_runs_select on source_check_runs
  for select to authenticated using (true);
create policy source_revision_chunks_select on source_revision_chunks
  for select to authenticated
  using (is_platform_admin() or source_revision_is_published(source_revision_id));

create trigger source_captures_append_only
  before update or delete on source_captures
  for each row execute function forbid_update_delete();
create trigger source_check_runs_append_only
  before update or delete on source_check_runs
  for each row execute function forbid_update_delete();
create trigger source_capture_decisions_append_only
  before update or delete on source_capture_decisions
  for each row execute function forbid_update_delete();
create trigger source_revision_chunks_append_only
  before update or delete on source_revision_chunks
  for each row execute function forbid_update_delete();

revoke all on source_captures, source_check_runs, source_capture_decisions, source_revision_chunks
  from anon, authenticated, service_role;
grant select on source_captures, source_check_runs, source_capture_decisions, source_revision_chunks
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_source_check (service_role only: the Inngest source-check job)
-- ---------------------------------------------------------------------------
create function record_source_check(
  p_source_id uuid,
  p_idempotency_key text,
  p_result text,                 -- 'fetched' | 'not_modified' | 'failed' | 'blocked'
  p_http_status integer default null,
  p_final_url text default null,
  p_content_type text default null,
  p_byte_length integer default null,
  p_etag text default null,
  p_last_modified text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_requested_by uuid default null,
  p_capture jsonb default null   -- { content_sha256, loader, loader_version, text, chunks } when fetched
)
returns table (check_run_id uuid, outcome source_check_outcome, capture_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_existing source_check_runs%rowtype;
  v_outcome source_check_outcome;
  v_capture_id uuid;
  v_sha text;
  v_last_capture source_captures%rowtype;
  v_run_id uuid;
begin
  select * into v_existing from source_check_runs where idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.outcome, v_existing.capture_id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('source_check:' || p_source_id::text));

  -- Re-check under the lock: a concurrent replay may have just committed.
  select * into v_existing from source_check_runs where idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.outcome, v_existing.capture_id;
    return;
  end if;

  if not exists (select 1 from jurisdiction_sources where id = p_source_id and archived_at is null) then
    raise exception 'source % not found or archived', p_source_id using errcode = 'no_data_found';
  end if;

  if p_result = 'fetched' then
    if p_capture is null or jsonb_typeof(p_capture) <> 'object' then
      raise exception 'a fetched result needs a capture' using errcode = 'invalid_parameter_value';
    end if;
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
  elsif p_result in ('not_modified', 'failed', 'blocked') then
    v_outcome := p_result::source_check_outcome;
    v_sha := null;
  else
    raise exception 'unknown check result %', p_result using errcode = 'invalid_parameter_value';
  end if;

  insert into source_check_runs (source_id, idempotency_key, outcome, http_status, final_url, content_type,
    byte_length, content_sha256, etag, last_modified, error_code, error_message, capture_id, requested_by, checked_at)
  values (p_source_id, p_idempotency_key, v_outcome, p_http_status, p_final_url, p_content_type,
    p_byte_length, v_sha, p_etag, p_last_modified, p_error_code, left(p_error_message, 2000), v_capture_id, p_requested_by,
    clock_timestamp())
  returning id into v_run_id;

  return query select v_run_id, v_outcome, v_capture_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- publish_source_revision / dismiss_source_capture (platform admins)
-- ---------------------------------------------------------------------------
create function publish_source_revision(
  p_capture_id uuid,
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
  v_capture source_captures%rowtype;
  v_previous source_revisions%rowtype;
  v_revision_id uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can publish a source revision' using errcode = 'insufficient_privilege';
  end if;

  select * into v_capture from source_captures where id = p_capture_id;
  if not found then
    raise exception 'capture % not found', p_capture_id using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('source_check:' || v_capture.source_id::text));

  if exists (select 1 from source_capture_decisions where capture_id = p_capture_id) then
    raise exception 'capture % has already been decided', p_capture_id using errcode = 'unique_violation';
  end if;
  if not exists (select 1 from jurisdiction_sources where id = v_capture.source_id and archived_at is null) then
    raise exception 'source % is archived', v_capture.source_id using errcode = 'no_data_found';
  end if;

  select * into v_previous from source_revisions
    where source_id = v_capture.source_id order by revision_number desc limit 1;

  insert into source_revisions (source_id, revision_number, content_sha256, title, issuing_body, published_on,
    effective_from, effective_to, retrieved_at, access_scope, licence_notes, supersedes_revision_id, created_by)
  values (v_capture.source_id, coalesce(v_previous.revision_number, 0) + 1, v_capture.content_sha256,
    p_title, p_issuing_body, p_published_on, p_effective_from, p_effective_to, v_capture.captured_at,
    p_access_scope, p_licence_notes, v_previous.id, v_actor)
  returning id into v_revision_id;

  insert into source_revision_chunks (source_revision_id, chunk_index, locator, content)
  select v_revision_id, (c->>'index')::integer, c->>'locator', c->>'content'
  from jsonb_array_elements(v_capture.chunks) c;

  insert into source_revision_reviews (source_revision_id, status, notes, reviewed_by, reviewed_at)
  values (v_revision_id, 'verified', p_notes, v_actor, clock_timestamp());

  insert into source_capture_decisions (capture_id, decision, source_revision_id, notes, decided_by)
  values (p_capture_id, 'published', v_revision_id, p_notes, v_actor);

  return v_revision_id;
end;
$$;

create function dismiss_source_capture(p_capture_id uuid, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_decision_id uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can dismiss a capture' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from source_captures where id = p_capture_id) then
    raise exception 'capture % not found', p_capture_id using errcode = 'no_data_found';
  end if;

  insert into source_capture_decisions (capture_id, decision, notes, decided_by)
  values (p_capture_id, 'dismissed', p_notes, v_actor)
  returning id into v_decision_id;
  return v_decision_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- source_check_status: one row per active source (scheduler + console), so
-- callers never page through the whole check history.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: open_captures counts only what the caller may see
-- (platform admins and service_role see all; others see 0).
create function source_check_status()
returns table (
  source_id uuid,
  source_type jurisdiction_source_type,
  last_attempt_at timestamptz,
  last_outcome source_check_outcome,
  last_success_at timestamptz,
  last_etag text,
  last_modified text,
  open_captures bigint
)
language sql
stable
set search_path = public
as $$
  select
    js.id,
    js.source_type,
    attempt.checked_at,
    attempt.outcome,
    success.checked_at,
    success.etag,
    success.last_modified,
    (select count(*) from source_captures c
      where c.source_id = js.id
        and not exists (select 1 from source_capture_decisions d where d.capture_id = c.id))
  from jurisdiction_sources js
  left join lateral (
    select r.checked_at, r.outcome from source_check_runs r
    where r.source_id = js.id order by r.checked_at desc limit 1
  ) attempt on true
  left join lateral (
    select r.checked_at, r.etag, r.last_modified from source_check_runs r
    where r.source_id = js.id and r.outcome in ('changed', 'unchanged', 'not_modified')
    order by r.checked_at desc limit 1
  ) success on true
  where js.archived_at is null;
$$;

-- ---------------------------------------------------------------------------
-- search_source_evidence: full-text search over published revisions
-- ---------------------------------------------------------------------------
-- Exact filters before ranking (master prompt §11): one jurisdiction, active
-- sources, the newest revision per source whose effective window covers
-- p_as_of (null bounds = unknown, not excluded), and only if that revision
-- is published. SECURITY INVOKER: the chunk RLS applies as well, and the
-- published filter is explicit so a service_role caller gets the same rows.
create function search_source_evidence(
  p_jurisdiction_id uuid,
  p_query_text text,
  p_as_of date default current_date,
  p_match_count integer default 8
)
returns table (
  chunk_id uuid,
  source_revision_id uuid,
  source_id uuid,
  source_type jurisdiction_source_type,
  source_url text,
  title text,
  issuing_body text,
  revision_number integer,
  locator text,
  content text,
  published_on date,
  effective_from date,
  effective_to date,
  retrieved_at timestamptz,
  access_scope source_access_scope,
  last_checked_at timestamptz,
  rank real
)
language sql
stable
set search_path = public
as $$
  with current_revision as (
    select distinct on (sr.source_id) sr.*
    from source_revisions sr
    join jurisdiction_sources js on js.id = sr.source_id
    where js.jurisdiction_id = p_jurisdiction_id
      and js.archived_at is null
      and (sr.effective_from is null or sr.effective_from <= p_as_of)
      and (sr.effective_to is null or sr.effective_to >= p_as_of)
    order by sr.source_id, sr.revision_number desc
  ),
  published as (
    select * from current_revision cr where source_revision_is_published(cr.id)
  ),
  search_query as (
    select websearch_to_tsquery('english', coalesce(p_query_text, '')) as tsq
  )
  select
    c.id, p.id, p.source_id, js.source_type, js.url, p.title, p.issuing_body, p.revision_number,
    c.locator, c.content, p.published_on, p.effective_from, p.effective_to, p.retrieved_at, p.access_scope,
    (select max(r.checked_at) from source_check_runs r
      where r.source_id = p.source_id and r.outcome in ('changed', 'unchanged', 'not_modified')),
    ts_rank_cd(c.content_tsv, q.tsq)
  from source_revision_chunks c
  join published p on p.id = c.source_revision_id
  join jurisdiction_sources js on js.id = p.source_id
  cross join search_query q
  where c.content_tsv @@ q.tsq
  order by ts_rank_cd(c.content_tsv, q.tsq) desc, c.source_revision_id, c.chunk_index
  limit least(greatest(coalesce(p_match_count, 8), 1), 20);
$$;

-- ---------------------------------------------------------------------------
-- publish_rule_set_version (platform admins)
-- ---------------------------------------------------------------------------
-- p_items: [{ "permit_requirement_id": uuid, "condition": object|null,
--             "requires": [uuid, ...] }, ...]
-- Each item's snapshot is built here from the live permit_requirements row
-- (title/description/applies_when) -- never from the caller. Every item must
-- be a verified, unretired requirement of this permit type. Conditions and
-- prerequisites are validated by the app (Zod + cycle check) before the
-- call; a set that slips past that is reported 'rule_set_invalid' by the 6.2
-- engine and evaluates to unknown, never to not_applicable.
create function publish_rule_set_version(
  p_jurisdiction_id uuid,
  p_permit_type_id uuid,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_previous rule_set_versions%rowtype;
  v_version_id uuid;
  v_bad uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can publish a rule set' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from permit_types where id = p_permit_type_id and jurisdiction_id = p_jurisdiction_id) then
    raise exception 'permit type % does not belong to jurisdiction %', p_permit_type_id, p_jurisdiction_id
      using errcode = 'foreign_key_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a rule set needs at least one item' using errcode = 'invalid_parameter_value';
  end if;

  select (i->>'permit_requirement_id')::uuid into v_bad
  from jsonb_array_elements(p_items) i
  where not exists (
    select 1 from permit_requirements pr
    where pr.id = (i->>'permit_requirement_id')::uuid
      and pr.permit_type_id = p_permit_type_id
      and pr.archived_at is null
      and pr.verification_status = 'verified'
  )
  limit 1;
  if found then
    raise exception 'requirement % is not a verified, current requirement of this permit type', v_bad
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('rule_set:' || p_jurisdiction_id::text || ':' || p_permit_type_id::text));

  select * into v_previous from rule_set_versions
    where jurisdiction_id = p_jurisdiction_id and permit_type_id = p_permit_type_id
    order by version desc limit 1;

  insert into rule_set_versions (jurisdiction_id, permit_type_id, version, supersedes_rule_set_id, notes, published_by)
  values (p_jurisdiction_id, p_permit_type_id, coalesce(v_previous.version, 0) + 1, v_previous.id, p_notes, v_actor)
  returning id into v_version_id;

  insert into rule_set_version_items (rule_set_version_id, permit_requirement_id, requirement_snapshot, source_revision_id)
  select
    v_version_id,
    pr.id,
    jsonb_build_object(
      'title', pr.title,
      'description', pr.description,
      'applies_when_text', pr.applies_when,
      'condition', case when jsonb_typeof(i->'condition') = 'object' then i->'condition' else 'null'::jsonb end,
      'requires', case when jsonb_typeof(i->'requires') = 'array' then i->'requires' else '[]'::jsonb end
    ),
    (select sr.id from source_revisions sr
      where pr.source_id is not null and sr.source_id = pr.source_id and source_revision_is_published(sr.id)
      order by sr.revision_number desc limit 1)
  from jsonb_array_elements(p_items) i
  join permit_requirements pr on pr.id = (i->>'permit_requirement_id')::uuid;

  return v_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (functions are executable by PUBLIC by default)
-- ---------------------------------------------------------------------------
revoke execute on function source_revision_is_published(uuid) from public, anon;
grant execute on function source_revision_is_published(uuid) to authenticated, service_role;

revoke execute on function record_source_check(uuid, text, text, integer, text, text, integer, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function record_source_check(uuid, text, text, integer, text, text, integer, text, text, text, text, uuid, jsonb)
  to service_role;

revoke execute on function publish_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text)
  from public, anon;
grant execute on function publish_source_revision(uuid, text, text, date, date, date, source_access_scope, text, text)
  to authenticated;

revoke execute on function dismiss_source_capture(uuid, text) from public, anon;
grant execute on function dismiss_source_capture(uuid, text) to authenticated;

revoke execute on function source_check_status() from public, anon;
grant execute on function source_check_status() to authenticated, service_role;

revoke execute on function search_source_evidence(uuid, text, date, integer) from public, anon;
grant execute on function search_source_evidence(uuid, text, date, integer) to authenticated, service_role;

revoke execute on function publish_rule_set_version(uuid, uuid, text, jsonb) from public, anon;
grant execute on function publish_rule_set_version(uuid, uuid, text, jsonb) to authenticated;
