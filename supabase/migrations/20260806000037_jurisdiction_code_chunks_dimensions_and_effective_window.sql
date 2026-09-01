-- Gate AI-1, sub-phase AI-1.2 (GATE_AI_1_FINDINGS.md §B, §G "AI-1.2 --
-- Retrieval layer", §H STALE_BYLAW). Additive-only, per this repo's
-- established migration convention: no existing column, table, or enum
-- value altered or removed. jurisdiction_code_chunks and
-- search_jurisdiction_code_chunks (20260806000008, 20260806000014) are both
-- already live -- the one real caller is
-- lib/ai/retrieve-code-chunks.ts:retrieveCodeChunks(), itself called from
-- lib/inngest/functions/audit.ts:143-146 -- so every change here is
-- structured to keep that existing caller working unmodified (it will
-- simply not pass the new optional arguments, which all default to
-- "no additional narrowing").
--
-- §B found jurisdiction_code_chunks has no permit_type/property_type/
-- language column at all, and no effective-date WINDOW (only a single
-- nullable effective_date passed straight through, never filtered or
-- ordered on). Both gaps are closed here:
--
-- 1. permit_type / property_type / language (all nullable, no default):
--    NULL on a chunk row means "applies regardless of this dimension" --
--    universal match -- not "unknown, exclude it." This mirrors how an
--    empty corpus today already returns everything unfiltered by these
--    dimensions; adding the columns must not make existing (zero) rows
--    suddenly excluded from anything once ingestion eventually populates
--    the table with a mix of dimension-tagged and untagged chunks.
-- 2. effective_from / effective_to (nullable, no default): the actual
--    STALE_BYLAW fix. A chunk is "currently effective" when
--    (effective_from is null or effective_from <= as-of-date) and
--    (effective_to is null or effective_to > as-of-date) -- both null
--    means "always effective," matching every pre-existing row's
--    (non-)behavior. Superseding a chunk means setting its effective_to to
--    the date its replacement took over, not deleting or mutating its
--    content -- this table has no update/delete restriction today (unlike
--    the AI-1.1 append-only tables) because it's an ingestion corpus, not
--    an audit trail; re-ingestion is expected to UPDATE effective_to on
--    superseded rows.
--
-- effective_from/effective_to get their own check constraint (window must
-- not be inverted) but are deliberately NOT tied to effective_date via a
-- constraint -- effective_date's own meaning (passed through to callers
-- unchanged since 20260806000014) is left alone rather than redefined
-- as part of this window, per the additive-only convention.

alter table jurisdiction_code_chunks
  add column permit_type text,
  add column property_type text,
  add column language text,
  add column effective_from date,
  add column effective_to date,
  add constraint jurisdiction_code_chunks_effective_window_check
    check (effective_from is null or effective_to is null or effective_to > effective_from);

-- Composite index for the new dimension filters, jurisdiction_id-first since
-- every query (via the RPC) is always scoped to one jurisdiction first --
-- mirrors the existing jurisdiction_code_chunks_jurisdiction_id_idx's own
-- scoping assumption rather than introducing a new access pattern.
create index jurisdiction_code_chunks_dimensions_idx on jurisdiction_code_chunks
  (jurisdiction_id, permit_type, property_type, language);

-- search_jurisdiction_code_chunks cannot be changed in-place via
-- CREATE OR REPLACE FUNCTION here: Postgres only allows CREATE OR REPLACE to
-- append new parameters with defaults to the end of an existing function's
-- signature when the RETURN TYPE is unchanged; this migration also adds new
-- output columns to the RETURNS TABLE shape (so the caller can see which
-- dimension/window values a match actually had, for future debugging/
-- observability), which Postgres rejects on CREATE OR REPLACE ("cannot
-- change return type of existing function"). DROP + CREATE is safe here:
-- the corpus is still empty in every environment
-- (lib/ai/retrieve-code-chunks.ts's own header comment,
-- GATE_AI_1_FINDINGS.md §B), so there is no live data or in-flight query
-- that a function-identity change could disrupt, and grants/execute
-- privileges are reissued immediately below in the same migration so there
-- is no window where the function exists but is uncallable.
drop function if exists search_jurisdiction_code_chunks(uuid, text, vector, int);

-- p_permit_type / p_property_type / p_language (all nullable, default null):
-- optional narrowing filters. A chunk matches a given dimension filter when
-- EITHER the filter arg is null (caller isn't filtering on that dimension)
-- OR the chunk's own column is null (chunk is universal on that dimension)
-- OR the two values are equal. This is the same "null means unrestricted,
-- on either side" semantics used for the effective-window check below, and
-- it is exactly why the existing caller (retrieve-code-chunks.ts, which
-- passes none of these three new args yet) continues to get today's
-- unfiltered-by-dimension behavior unchanged: all three filter args default
-- null, so every dimension clause below short-circuits to "no filtering."
--
-- p_as_of_date (default current_date): the STALE_BYLAW fix. Unlike the
-- three dimension filters above, this is NOT optional/caller-gated -- it is
-- always applied, because it is a correctness defense
-- (GATE_AI_1_FINDINGS.md §H: "a superseded chunk retrieved and cited as
-- current"), not a caller-chosen narrowing. Defaulting to current_date
-- means the existing caller gets the fix automatically, with no code change
-- required on its part, while still allowing a future caller to pass an
-- explicit historical date if that's ever needed (e.g. re-auditing an old
-- application against the code as it stood on the application's own
-- submission date) without a second function.
create function search_jurisdiction_code_chunks(
  p_jurisdiction_id uuid,
  p_query_text text,
  p_query_embedding vector(1024) default null,
  p_match_count int default 8,
  p_permit_type text default null,
  p_property_type text default null,
  p_language text default null,
  p_as_of_date date default current_date
)
returns table (
  id uuid,
  code_section text,
  content text,
  source_url text,
  effective_date date,
  corpus_version text,
  permit_type text,
  property_type text,
  language text,
  effective_from date,
  effective_to date,
  rrf_score double precision
)
language sql
stable
as $$
  with bm25_ranked as (
    select
      c.id,
      row_number() over (
        order by ts_rank(c.content_tsv, plainto_tsquery('english', p_query_text)) desc
      ) as rnk
    from jurisdiction_code_chunks c
    where c.jurisdiction_id = p_jurisdiction_id
      and c.license_status = 'public_record'
      and c.content_tsv @@ plainto_tsquery('english', p_query_text)
      and (p_permit_type is null or c.permit_type is null or c.permit_type = p_permit_type)
      and (p_property_type is null or c.property_type is null or c.property_type = p_property_type)
      and (p_language is null or c.language is null or c.language = p_language)
      and (c.effective_from is null or c.effective_from <= p_as_of_date)
      and (c.effective_to is null or c.effective_to > p_as_of_date)
  ),
  vector_ranked as (
    select
      c.id,
      row_number() over (order by c.embedding <=> p_query_embedding) as rnk
    from jurisdiction_code_chunks c
    where c.jurisdiction_id = p_jurisdiction_id
      and c.license_status = 'public_record'
      and p_query_embedding is not null
      and c.embedding is not null
      and (p_permit_type is null or c.permit_type is null or c.permit_type = p_permit_type)
      and (p_property_type is null or c.property_type is null or c.property_type = p_property_type)
      and (p_language is null or c.language is null or c.language = p_language)
      and (c.effective_from is null or c.effective_from <= p_as_of_date)
      and (c.effective_to is null or c.effective_to > p_as_of_date)
  ),
  fused as (
    select
      coalesce(b.id, v.id) as id,
      (1.0 / (60 + coalesce(b.rnk, 1000000)))
        + (1.0 / (60 + coalesce(v.rnk, 1000000))) as rrf_score
    from bm25_ranked b
    full outer join vector_ranked v on v.id = b.id
  )
  select
    c.id,
    c.code_section,
    c.content,
    c.source_url,
    c.effective_date,
    c.corpus_version,
    c.permit_type,
    c.property_type,
    c.language,
    c.effective_from,
    c.effective_to,
    f.rrf_score
  from fused f
  join jurisdiction_code_chunks c on c.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
$$;

-- Same reissue-immediately discipline as 20260806000014's own original
-- grants (Postgres grants EXECUTE to PUBLIC by default on a newly created
-- function -- the DROP above removed the old function's grants along with
-- it, so this is not optional cleanup, the function is uncallable by either
-- role without it).
revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date) from public;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date) to authenticated;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date) to service_role;
