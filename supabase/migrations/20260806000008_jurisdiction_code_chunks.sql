-- 3.12. Retrieval is hybrid (BM25 via tsvector + vector), not pure semantic --
-- code lookup is heavily keyed on exact section numbers and terms like "400A"
-- that embedding similarity performs badly on (SS3.12). Both index types are
-- created here, not just one.
--
-- Embedding dimension: Anthropic serves no embeddings endpoint (SS2). Phase 0
-- proposes Voyage AI `voyage-3` (1024 dims) as the provider -- flagged there as
-- an assumption to confirm, not a unilateral final call. vector(1024) below
-- matches that proposal; changing provider before real ingestion starts is a
-- cheap migration, not a rewrite.

create type license_status as enum ('public_record', 'copyrighted', 'unknown');

create table jurisdiction_code_chunks (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  code_section text not null,
  content text not null,
  source_url text not null,
  effective_date date,
  retrieved_at timestamptz not null default now(),
  -- SS0.4: ingest only municipal amendments / local ordinances / permit
  -- checklists / application instructions -- never ICC/NEC/IBC model-code body
  -- text. license_status defaults to the safe/excluded value; ingestion code
  -- must explicitly set 'public_record' after a provenance check, it is never
  -- the implicit default a bulk insert falls into.
  license_status license_status not null default 'unknown',
  corpus_version text not null,
  embedding vector(1024),
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);

create index jurisdiction_code_chunks_jurisdiction_id_idx on jurisdiction_code_chunks (jurisdiction_id);
create index jurisdiction_code_chunks_tsv_idx on jurisdiction_code_chunks using gin (content_tsv);
-- ivfflat requires rows to build meaningful lists; fine to create empty pre-ingestion,
-- but `lists` should be re-tuned (roughly sqrt(row_count)) once real corpus volume exists.
create index jurisdiction_code_chunks_embedding_idx on jurisdiction_code_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table jurisdiction_code_chunks enable row level security;

-- SS0.4 enforced again at the RLS layer, not just in application query
-- filters: even an ad-hoc authenticated query can never see a chunk whose
-- license_status isn't public_record. service_role (the ingestion pipeline)
-- bypasses RLS and can read/write every row regardless of status, since Phase 2
-- needs to record rejected/unknown-status chunks too, just never serve them.
create policy jurisdiction_code_chunks_select on jurisdiction_code_chunks
  for select to authenticated
  using (license_status = 'public_record');
