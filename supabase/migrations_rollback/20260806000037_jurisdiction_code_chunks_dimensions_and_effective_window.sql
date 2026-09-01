-- Rollback for 20260806000037_jurisdiction_code_chunks_dimensions_and_effective_window.sql
-- Recreates search_jurisdiction_code_chunks with its pre-37 4-argument
-- signature and RETURNS TABLE shape (verbatim from
-- 20260806000014_search_jurisdiction_code_chunks.sql), the same DROP+CREATE
-- discipline 37's own header used going forward, applied here in reverse.
-- Corpus is still empty in every environment (37's own header), so there is
-- no live data or in-flight query a function-identity change could disrupt.

revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date) from service_role;
revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date) from authenticated;

drop function if exists search_jurisdiction_code_chunks(uuid, text, vector, int, text, text, text, date);

create function search_jurisdiction_code_chunks(
  p_jurisdiction_id uuid,
  p_query_text text,
  p_query_embedding vector(1024) default null,
  p_match_count int default 8
)
returns table (
  id uuid,
  code_section text,
  content text,
  source_url text,
  effective_date date,
  corpus_version text,
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
    f.rrf_score
  from fused f
  join jurisdiction_code_chunks c on c.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
$$;

revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) from public;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) to authenticated;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) to service_role;

drop index if exists jurisdiction_code_chunks_dimensions_idx;

alter table jurisdiction_code_chunks
  drop constraint if exists jurisdiction_code_chunks_effective_window_check,
  drop column if exists effective_to,
  drop column if exists effective_from,
  drop column if exists language,
  drop column if exists property_type,
  drop column if exists permit_type;
