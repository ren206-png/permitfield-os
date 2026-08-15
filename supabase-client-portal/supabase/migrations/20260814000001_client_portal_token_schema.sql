-- =============================================================================
-- STATUS: UNVERIFIED. Read this before trusting anything below.
--
-- This migration has never executed against a real Postgres instance, ever.
-- It was written with Docker unavailable locally (untested then), and there
-- is no CI path that runs it now: .github/workflows/ci.yml's sql-tests job
-- only executes supabase/tests/*.test.sql (project 1) -- it has zero
-- reference to supabase-client-portal/ or this file's own test,
-- client_portal_token_lifecycle.test.sql, which has likewise never run.
--
-- The second Supabase project this migration targets does not exist yet.
-- supabase-client-portal/supabase/config.toml's project_id is local CLI
-- config, not evidence of a live, provisioned project -- grepped
-- .env.example and lib/ for any CLIENT_PORTAL_SUPABASE_* var or equivalent:
-- zero hits.
-- GATE_2_0_FINDINGS.md SS H.5 named provisioning that project as a hard
-- precondition and sequenced it as 2.1's own first step; it did not happen,
-- and this file landing on `main` regardless does not retroactively make it
-- happen. Gate 2.0 sub-phase 2.2's audit_logs migration (already merged)
-- already stores external_actor_id values documented as pointing at
-- client_access_tokens.id here -- a table that exists in no live database
-- anywhere. Provisioning this project and wiring sql-tests to actually run
-- supabase-client-portal/supabase/tests/ is a blocker for the gate, not a
-- follow-up.
--
-- Being on `main` means reviewed and versioned. It does not mean verified.
-- Do not treat this file as validated until it has actually run somewhere
-- and its own test file has passed for real, not just been read closely.
-- =============================================================================

-- Gate 2.0 sub-phase 2.1 (GATE_2_0_SPEC.md SS2, "Tables (second project)").
-- Stands up the three tables this sub-phase is scoped to in the second,
-- dedicated Supabase project: client_access_tokens, token_lifecycle_events,
-- client_access_log. Transcribed verbatim from SS2's SQL block, with one
-- fix applied: GATE_2_0_FINDINGS.md SS H.4 found that SS2 as literally
-- written calls gen_random_uuid() five times but never enables pgcrypto
-- for this project. Project 1's own enablement
-- (supabase/migrations/20260806000001_...) has zero effect here -- these
-- are separate Postgres instances with no shared extension state (same
-- reason they share no FK space, SS2's design-constraint note). Without
-- this, every `default gen_random_uuid()` below would fail on a fresh
-- project the first time a row is inserted.
create extension if not exists pgcrypto;

create type token_status as enum ('active', 'expired', 'revoked', 'superseded');

-- The bearer credential is never stored -- only its hash. Validation is
-- "hash the presented token, look up by hash, check status/expiry,"
-- identical in shape to a password-hash check, not a JWT-verify.
create table client_access_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Cross-project pointers. Bare, not FKs -- see design-constraint note
  -- in GATE_2_0_SPEC.md SS2. Both required: application_id scopes what the
  -- token can reach, org_id exists specifically so an org-offboarding bulk
  -- revoke ("UPDATE ... WHERE org_id = :x") doesn't require joining back
  -- through every application_id first.
  application_id uuid not null,
  org_id uuid not null,

  -- Recipient identity, stored twice on purpose. recipient_email is the
  -- normalized join/uniqueness key (lowercased, trimmed) -- see SS2's
  -- forward-path self-check for exactly why this CHECK exists: without it,
  -- the future client_accounts join is a fuzzy-match problem, not an
  -- equality join. recipient_email_display is exactly what staff typed,
  -- unmodified -- outbound mail and any "we sent this to X" confirmation
  -- shown back to staff should render what was entered, not the normalized
  -- form. The second CHECK ties the two together structurally, not by
  -- convention: recipient_email_display can only ever be a case/whitespace
  -- variant of recipient_email, never an independently-typed second value
  -- that could silently drift from the real recipient.
  recipient_email_display text not null,
  recipient_email text not null check (recipient_email = lower(btrim(recipient_email))),
  check (lower(btrim(recipient_email_display)) = recipient_email),
  recipient_name text,

  token_hash text not null,
  status token_status not null default 'active',

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,

  -- Exactly-one-representation pattern (same shape as SS4's audit_logs
  -- design, applied here first because this table needed it before
  -- audit_logs did): revocation is always triggered by org staff acting
  -- through the bridge layer or by the system (auto-expiry is a status
  -- read, not a revocation, so this pair is specifically about explicit
  -- revoke actions). Staff identity is a bare, non-FK uuid for the same
  -- cross-project reason application_id/org_id are bare above.
  revoked_by_org_user_id uuid,
  revoked_by_system boolean not null default false,

  unique (token_hash),
  check (
    (revoked_at is null and revoked_by_org_user_id is null and revoked_by_system is false)
    or
    (revoked_at is not null and (revoked_by_org_user_id is not null) <> revoked_by_system)
  )
);

-- At most one ACTIVE token per recipient+application -- the DB-level
-- expression of "one token per recipient" from SS1.
create unique index client_access_tokens_one_active_per_recipient
  on client_access_tokens (recipient_email, application_id)
  where status = 'active';

create index client_access_tokens_application_id_idx on client_access_tokens (application_id);
create index client_access_tokens_org_id_idx on client_access_tokens (org_id);

-- Append-only. Every lifecycle transition from SS1's matrix, one row each.
create table token_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references client_access_tokens(id),
  from_status token_status,
  to_status token_status not null,
  occurred_at timestamptz not null default now(),
  -- Same non-FK actor pair as client_access_tokens.revoked_by_* above,
  -- reused here rather than re-invented, since every transition this table
  -- records has the identical "staff or system, never the recipient" actor
  -- shape SS1's matrix already established.
  triggered_by_org_user_id uuid,
  triggered_by_system boolean not null default false,
  check ((triggered_by_org_user_id is not null) <> triggered_by_system)
);

-- Append-only. Every bridge-layer invocation, successful or denied. This is
-- the accountability ledger SS1 requires ("every access logged with token
-- identity") -- distinct in purpose from the main project's audit_logs
-- (see SS4's reasoning for why these are not merged).
create table client_access_log (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references client_access_tokens(id),
  operation text not null,        -- one of SS3's enumerated operation names
  resource_type text,             -- e.g. 'application_documents', null for token-scoped reads with no sub-resource
  resource_id text,                -- bare id string, cross-project, same non-FK reasoning as above
  outcome text not null check (outcome in ('success', 'denied')),
  -- Populated only when outcome = 'denied' -- the granular reason
  -- (token_not_found / token_expired / token_revoked /
  -- application_not_found / ...) that SS3's failure-mode section
  -- deliberately does NOT return to the caller. This is where that detail
  -- lives instead: staff investigating "why did my client say the link
  -- doesn't work" read it here, through the bridge layer, not by the
  -- caller ever seeing it directly.
  detail text,
  ip inet,
  user_agent text,
  occurred_at timestamptz not null default now(),
  check ((outcome = 'denied') or (detail is null))
);

-- Project 2 has no access to the main project's forbid_update_delete()
-- function -- separate Postgres instances share no function catalog, the
-- same reason they share no FK space (see SS2's design-constraint note).
-- Re-defined here, identical in behavior, so these two ledgers get the same
-- tamper-resistance audit_logs has in the main project: this trigger
-- blocks UPDATE and DELETE for every role, including this project's own
-- service_role, which would otherwise have unrestricted access to these
-- two tables (see SS4's guarantees comparison for why this specific gap
-- mattered enough to fix here rather than leave implicit).
create function forbid_update_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op;
end;
$$;

create trigger token_lifecycle_events_forbid_update_delete
  before update or delete on token_lifecycle_events
  for each row execute function forbid_update_delete();

create trigger client_access_log_forbid_update_delete
  before update or delete on client_access_log
  for each row execute function forbid_update_delete();

alter table token_lifecycle_events enable row level security;
alter table client_access_log enable row level security;
alter table client_access_tokens enable row level security;
-- No policy for `authenticated`/`anon` on any of the three tables: this
-- project has no client-facing Supabase Auth session at all (see SS3's
-- closing note) -- every reader/writer is the bridge layer running as this
-- project's own service_role, which bypasses RLS. RLS is enabled anyway
-- (defense-in-depth, matches this codebase's own convention of enabling
-- RLS even on tables with no authenticated-role policy, e.g.
-- application_status_history) but has zero policies, so it default-denies
-- every role except service_role.

-- Explicit grants -- without these, service_role has zero privileges on
-- these three tables by default, the identical "BYPASSRLS is not a
-- substitute for GRANT" bug this codebase's main project has already hit
-- twice (20260806000015's header comment). client_access_tokens is
-- mutable (status transitions), so it gets update; the two ledgers get
-- select+insert only, matching audit_logs' own grant shape exactly --
-- never update/delete, even though the trigger above would block it
-- anyway. Belt and suspenders, not redundant: the grant is what stops an
-- accidental statement from being attempted at all; the trigger is what
-- stops it if the grant were ever mistakenly widened.
grant select, insert, update on client_access_tokens to service_role;
grant select, insert on token_lifecycle_events to service_role;
grant select, insert on client_access_log to service_role;
