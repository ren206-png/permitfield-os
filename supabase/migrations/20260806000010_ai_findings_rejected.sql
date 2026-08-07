-- 3.13. Findings dropped for failing the citation check (SS0.2) or Zod schema
-- validation (SS1 global rules) land here -- this is the hallucination-rate
-- metric, per the spec's own description ("without it you are flying blind").
-- It is an internal ops table: no policy grants `authenticated` any access at
-- all, so RLS denies everyone except service_role by default. There is
-- deliberately no per-org scoping here either -- this table's purpose is an
-- aggregate, cross-tenant eval signal (SS6's citation-validity-rate metric),
-- not a customer-facing record.

create table ai_findings_rejected (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references permit_applications(id) on delete set null,
  audit_id uuid,
  raw_finding jsonb not null,
  rejection_reason text not null,
  model_id text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create index ai_findings_rejected_application_id_idx on ai_findings_rejected (application_id);

alter table ai_findings_rejected enable row level security;
-- No policies: default-deny for `authenticated`/`anon`. Only service_role
-- (the audit pipeline writing rejections, and the eval harness reading them)
-- can touch this table.
