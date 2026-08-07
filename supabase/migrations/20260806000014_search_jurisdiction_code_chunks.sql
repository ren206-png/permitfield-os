-- Phase 3 / SS3.12: hybrid retrieval for the audit engine. Pure semantic
-- (vector) search alone is explicitly called out in the jurisdiction_code_chunks
-- migration's own header comment as insufficient for exact code-section-number
-- lookups (e.g. "400A") that embedding similarity handles poorly -- so this
-- function always runs BM25-style lexical ranking (content_tsv, already
-- GIN-indexed) and, when a query embedding is supplied, ALSO runs vector
-- similarity ranking (embedding, already ivfflat-indexed), then fuses the two
-- rankings with Reciprocal Rank Fusion (RRF).
--
-- RRF, not a weighted sum of raw scores: ts_rank's lexical score and cosine
-- distance live on incompatible, uncalibrated scales, so averaging or
-- weighting the raw numbers directly would be arbitrary. RRF instead combines
-- each result's RANK POSITION within each list (1/(k + rank)), which is
-- scale-free by construction. k=60 is the constant from the original RRF
-- paper (Cormack et al., 2009) and is not meant to be tuned per query --
-- widely reused as-is precisely because it doesn't need retuning.
--
-- Lexical ranking uses ts_rank, not ts_rank_cds: ts_rank_cds ("cover density")
-- errors as an unresolved function (42883) against this content_tsv/tsquery
-- pairing on Supabase's local Postgres image, despite being nominally a core
-- tsearch builtin -- rather than depend on an environment-specific overload
-- that isn't reliably resolvable here, this function uses the plain ts_rank,
-- which is universally available and differs only in not applying cover-
-- density proximity weighting; RRF fusion below is what actually determines
-- final ordering, so this loss of intra-list nuance is acceptable.
--
-- p_query_embedding is nullable and OPTIONAL by design: lib/flags.ts's
-- isVectorRetrievalEnabled() defaults OFF (empty corpus at MVP launch, see
-- that flag's own comment), so this function must degrade cleanly to
-- BM25-only ranking when no embedding is passed, not error or return nothing.
--
-- Explicit `license_status = 'public_record'` filter here even though the
-- table's own RLS policy already enforces this for the `authenticated` role
-- (SS0.4): this function is intended to be called from server-side code via
-- the service-role client (lib/ai/retrieve-code-chunks.ts), and service_role
-- bypasses RLS entirely -- so the filter is restated explicitly at the query
-- level rather than relied upon implicitly from a policy that won't apply to
-- this caller.
-- corpus_version is passed through on every returned row so the caller
-- (lib/inngest/functions/audit.ts, persisting audits.corpus_version) can
-- record exactly which ingestion snapshot backed a given audit run, without
-- a second round-trip.
create or replace function search_jurisdiction_code_chunks(
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
  -- full outer join: a chunk matched by only one of the two retrieval modes
  -- still gets a (smaller) fused score rather than being dropped, via the
  -- large-constant coalesce below standing in for "unranked / effectively
  -- last place" on whichever side it's missing from.
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

-- Postgres grants EXECUTE on new functions to PUBLIC by default -- this repo's
-- own convention (see 20260806000011_grants.sql's header) is explicit grants
-- only, never implicit defaults, so that default is revoked and reissued
-- deliberately below. Safe to expose to `authenticated` as well as
-- `service_role`: the function's own license_status filter means an
-- authenticated caller can see nothing through this RPC that
-- jurisdiction_code_chunks_select's RLS policy wouldn't already let them
-- query directly.
revoke execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) from public;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) to authenticated;
grant execute on function search_jurisdiction_code_chunks(uuid, text, vector, int) to service_role;
