-- Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K). Additive-only, per this
-- repo's standing migration convention.
--
-- Wires the drawing_category dimension column (added schema-only, with no
-- RPC filter, by 20260806000045's own header comment -- "declare now, wire
-- at the first real call site") into search_jurisdiction_code_chunks, so
-- lib/ai/retrieve-code-chunks.ts's new drawingCategory filter
-- (Gate 5.2 -- this is that first real call site) has an RPC argument to
-- pass. Same DROP + CREATE FUNCTION discipline as
-- 20260806000037_jurisdiction_code_chunks_dimensions_and_effective_window.sql's
-- own header explains: Postgres allows CREATE OR REPLACE to append new
-- defaulted parameters when the RETURN TYPE is unchanged, but this migration
-- also adds a new output column to the RETURNS TABLE shape (drawing_category,
-- for the same observability reason 20260806000037 added its own three new
-- output columns), which Postgres rejects on CREATE OR REPLACE. DROP +
-- CREATE is safe here for the same reason it was safe in 20260806000037: the
-- corpus is still empty in every environment (no ingestion pipeline exists
-- yet -- GATE_5_FINDINGS.md §E.5 / lib/ai/retrieve-code-chunks.ts's own
-- header comment), so there is no live data or in-flight query a
-- function-identity change could disrupt, and grants/execute privileges are
-- reissued immediately below in the same migration so there is no window
-- where the function exists but is uncallable.
drop function if exists search_jurisdiction_code_chunks(
  uuid, text, vector, int, text, text, text, date
);

-- p_drawing_category (nullable, default null): optional narrowing filter,
-- same "null means unrestricted, on either side" semantics as
-- p_permit_type/p_property_type/p_language (20260806000037's own header
-- comment) -- a chunk matches when EITHER the filter arg is null (caller
-- isn't filtering on drawing category) OR the chunk's own drawing_category
-- is null (chunk is universal across drawing categories) OR the two values
-- are equal. This is exactly why the existing callers (audit.ts via
-- retrieveCodeChunks, which passes none of the dimension filters; the new
-- drawing-review caller, which passes every dimension EXCEPT this one until
-- a real drawing-category classifier exists -- see
-- lib/ai/retrieve-code-chunks.ts's own header comment) continue to get
-- today's unfiltered-by-drawing-category behavior unchanged: the filter arg
-- defaults null, so this clause always short-circuits to "no filtering" for
-- both of them right now.
create function search_jurisdiction_code_chunks(
  p_jurisdiction_id uuid,
  p_query_text text,
  p_query_embedding vector(1024) default null,
  p_match_count int default 8,
  p_permit_type text default null,
  p_property_type text default null,
  p_language text default null,
  p_as_of_date date default current_date,
  p_drawing_category text default null
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
  drawing_category text,
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
      and (p_drawing_category is null or c.drawing_category is null or c.drawing_category = p_drawing_category)
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
      and (p_drawing_category is null or c.drawing_category is null or c.drawing_category = p_drawing_category)
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
    c.drawing_category,
    f.rrf_score
  from fused f
  join jurisdiction_code_chunks c on c.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
$$;

-- Same reissue-immediately discipline as 20260806000037's own grants --
-- Postgres grants EXECUTE to PUBLIC by default on a newly created function,
-- and the DROP above removed the old function's grants along with it, so
-- this is not optional cleanup: the function is uncallable by either role
-- without it.
revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date, text) from public;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date, text) to authenticated;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date, text) to service_role;
