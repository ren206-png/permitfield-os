-- Gate 6, sub-phase 6.4: the staff copilot's model calls are recorded in
-- ai_jobs / ai_token_ledger (20260806000036) like every other AI call, so
-- they count toward the existing per-user and per-org cost caps
-- (lib/ai/cost-caps.ts). They need their own task kind so they can be
-- rate-limited and reported separately from the help assistant.
--
-- Additive only, per that migration's own convention ("extensible via
-- alter type ai_task_kind add value if not exists ... never a value
-- rename").
--
-- Rollback: Postgres cannot drop an enum value. If 6.4 is rolled back, the
-- value stays unused; no row is written with it while
-- PERMITFIELD_FF_COPILOT is off.

alter type ai_task_kind add value if not exists 'copilot';

-- Fact review (6.4): a fact row is decided or corrected at most once. A
-- second confirm/reject of the same proposal -- two tabs, a double click --
-- fails with unique_violation instead of leaving two competing decisions.
-- project_facts is append-only and new in 6.1 (empty in production), so
-- this index cannot conflict with existing rows.
-- Rollback: drop index if exists project_facts_superseded_once;
create unique index if not exists project_facts_superseded_once
  on project_facts (supersedes_fact_id)
  where supersedes_fact_id is not null;
