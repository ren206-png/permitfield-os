-- Gate AI-1, sub-phase AI-1.2 (GATE_AI_1_FINDINGS.md §C, §G "AI-1.2 --
-- Retrieval layer", §H CROSS_TENANT_RAG). §C found there is no retrieval
-- path over an org's own uploaded application_documents at all today --
-- the only retrieval corpus in this repo is the public, jurisdiction-wide
-- jurisdiction_code_chunks table, whose RLS is scoped by license_status,
-- not by org, because it isn't tenant data. This migration is the new,
-- genuinely additional capability §G's own AI-1.2 scope line describes
-- ("Retrieval query filters to the caller's org (for uploaded docs) plus
-- public jurisdiction sources") -- it did not exist in any form before this
-- migration.
--
-- SCHEMA ONLY, NO INGESTION PIPELINE: this migration ships the table, its
-- RLS, and the retrieval RPC below -- it does NOT ship a chunking/embedding
-- pipeline to populate application_document_chunks from application_documents.
-- No code anywhere in this repo inserts a row into this table yet (grep
-- confirms). Same "declared now, enforced later" discipline as every AI-1.1
-- table and lib/ai/router.ts's zero call sites -- see GATE_AI_1_FINDINGS.md's
-- own accounting of this pattern throughout Gate AI-1. A future sub-phase
-- (AI-1.3, per §G's own scoping) is the natural owner of the actual
-- chunk+embed-on-upload-or-background-job step.
--
-- org_id is a DENORMALIZED column, not resolved via a join through
-- application_documents -> permit_applications the way
-- application_documents' own RLS does it (20260806000006...sql:77-105).
-- This mirrors 20260806000036's ai_jobs/ai_token_ledger precedent and §E's
-- own reasoning: a table this spend/privacy-sensitive (an org's own
-- document content, chunked and embedded) is exactly the kind where a
-- missing/wrong RLS filter is a direct cross-tenant data leak
-- (CROSS_TENANT_RAG, §H) -- a direct org_id column on every row, checked
-- both by RLS AND restated explicitly in the retrieval RPC's WHERE clause
-- below (the same defense-in-depth reasoning
-- search_jurisdiction_code_chunks already uses for license_status, since
-- service_role bypasses RLS entirely and every AI job runs as service_role),
-- is strictly safer than depending on a join to stay correct.
create table application_document_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references permit_applications(id) on delete cascade,
  application_document_id uuid not null references application_documents(id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  content text not null,
  embedding vector(1024),
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (application_document_id, chunk_index)
);

create index application_document_chunks_org_id_idx on application_document_chunks (org_id);
create index application_document_chunks_application_id_idx on application_document_chunks (application_id);
create index application_document_chunks_document_id_idx on application_document_chunks (application_document_id);
create index application_document_chunks_tsv_idx on application_document_chunks using gin (content_tsv);
-- Same "fine to create empty pre-ingestion, re-tune lists once real corpus
-- volume exists" caveat as jurisdiction_code_chunks_embedding_idx
-- (20260806000008...sql:36-39) -- this table starts even emptier (zero
-- ingestion pipeline exists at all, see header above).
create index application_document_chunks_embedding_idx on application_document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table application_document_chunks enable row level security;

-- SELECT only: an org member can read their own org's chunks. There is
-- deliberately no INSERT/UPDATE/DELETE policy for `authenticated` -- same
-- shape as extractions/audits (20260806000007.../20260806000009...): this
-- is AI-derived content, written only by a background ingestion job running
-- as service_role, never directly by an end user's session.
create policy application_document_chunks_select on application_document_chunks
  for select to authenticated
  using (is_org_member(org_id));

-- Append-only: chunk content should never be silently mutated in place --
-- re-chunking a re-processed document is expected to insert new rows (a new
-- application_document_id from a re-upload, or a future superseded_at-style
-- column if in-place re-chunking of the SAME document is ever needed) rather
-- than UPDATE existing ones, same "never overwrite what the model/pipeline
-- actually saw" reasoning as extractions' own header comment
-- (20260806000007...sql:1-3). Reuses forbid_update_delete(), the same
-- function extractions/ai_jobs/ai_token_ledger already share, rather than
-- inventing a new trigger body for an identical rule.
create trigger application_document_chunks_append_only
  before update or delete on application_document_chunks
  for each row execute function forbid_update_delete();

-- Explicit grants only (20260806000011...sql's own convention) --
-- INSERT/UPDATE/DELETE included in the `authenticated` grant alongside
-- SELECT for the same reason 20260806000011...sql:28-34 gives for
-- extractions/audits/audit_findings: so that an attempted mutation hits the
-- append-only trigger's specific error, not a generic RLS/permission-denied
-- that would leak nothing about which layer is enforcing it. RLS (only a
-- SELECT policy exists above) blocks INSERT for `authenticated` regardless
-- of this grant -- ingestion is service-role-only.
grant select, insert, update, delete on application_document_chunks to authenticated;
-- service_role: SELECT (for the retrieval RPC below, same reason
-- 20260806000015...sql:45 grants SELECT on jurisdiction_code_chunks to
-- service_role even though no code queries it via .from() directly yet) and
-- INSERT (for the future ingestion pipeline this migration deliberately
-- does not build -- granted now so that pipeline's own PR is schema-change-free,
-- same anticipatory-grant reasoning as every AI-1.1 table).
grant select, insert on application_document_chunks to service_role;

-- Supabase grants service_role TRUNCATE by platform default on every new
-- table, which bypasses row-level triggers entirely (TRUNCATE never fires
-- BEFORE UPDATE/DELETE triggers) -- the exact gap 20260806000033 closed for
-- the original 7 append-only tables, and 20260806000036 closed proactively
-- for the 3 new AI-1.1 tables in their own creating migration. Same
-- proactive close here, in the same migration that creates the table, so
-- there is no window where the gap existed and was merely undiscovered.
revoke truncate on application_document_chunks from service_role;

-- Mirrors search_jurisdiction_code_chunks's own RRF hybrid-retrieval shape
-- (20260806000014...sql) exactly, scoped by org_id AND application_id
-- instead of jurisdiction_id + license_status. `language sql` without
-- `security definer`, same reasoning as the jurisdiction RPC's own header:
-- meant to run under the CALLER's privileges so RLS still applies on top,
-- not be replaced by this function's own logic -- the explicit
-- `c.org_id = p_org_id` filter below is DEFENSE-IN-DEPTH for the case this
-- function is called by service_role (which bypasses RLS entirely, and
-- every AI job in this repo runs as service_role), the exact CROSS_TENANT_RAG
-- defense §H calls for, not a replacement for the RLS policy above.
-- p_application_id is additionally required (not optional) -- unlike
-- jurisdiction-wide retrieval, an org-scoped document query in this
-- codebase always originates from one specific permit_applications row
-- (the same context extract.ts/audit.ts already have), so there is no
-- legitimate "search across my whole org's documents" caller to support
-- yet; narrowing by both org_id and application_id closes the CROSS_TENANT_RAG
-- gap two ways at once (a bug leaking the org_id filter still can't cross an
-- application boundary within the same org).
create function search_application_document_chunks(
  p_org_id uuid,
  p_application_id uuid,
  p_query_text text,
  p_query_embedding vector(1024) default null,
  p_match_count int default 8
)
returns table (
  id uuid,
  application_document_id uuid,
  chunk_index int,
  content text,
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
    from application_document_chunks c
    where c.org_id = p_org_id
      and c.application_id = p_application_id
      and c.content_tsv @@ plainto_tsquery('english', p_query_text)
  ),
  vector_ranked as (
    select
      c.id,
      row_number() over (order by c.embedding <=> p_query_embedding) as rnk
    from application_document_chunks c
    where c.org_id = p_org_id
      and c.application_id = p_application_id
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
    c.application_document_id,
    c.chunk_index,
    c.content,
    f.rrf_score
  from fused f
  join application_document_chunks c on c.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
$$;

revoke execute on function search_application_document_chunks(uuid, uuid, text, vector, int) from public;
grant execute on function search_application_document_chunks(uuid, uuid, text, vector, int) to authenticated;
grant execute on function search_application_document_chunks(uuid, uuid, text, vector, int) to service_role;
