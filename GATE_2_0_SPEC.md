# Gate 2.0 Spec — Client Portal (Token-Scoped, Two-Project Model)

Format/rigor target: `docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` §3. Inputs:
master prompt §3, `PHASE_0_FINDINGS.md` (full), `GATE_2_0_FINDINGS.md` (full),
current schema state re-verified live against migrations
(`20260806000002`, `000006`, `000011`, `000015`, `000018`, `000019`,
`000022`, `000024`), `lib/authz/index.ts`, `docs/PERMISSIONS.md`,
`lib/storage/documents.ts`, `supabase/config.toml`.

Document only. No migration file, no component, no `client_visible` column
exists as a result of this document. `AGENTS.md` was not read or acted on.

## §0. Settled decisions (not reopened here)

- **§B: Option 2** — a second, separate Supabase project holds client
  identity and client-facing session state. Clients never authenticate into
  the main project. A privileged bridge layer (server-side only, holding
  service-role-equivalent credentials to *both* projects) is the only path
  by which client-tier code touches main-project data.
- **Access model**: token-scoped, no client accounts. One magic-link token
  per `permit_applications` row per recipient. A token is keyed to a
  recipient (email/person), never to a synthetic per-link identity — the
  same recipient re-issued a link gets a new token *for the same identity*,
  not an unrelated anonymous credential.

## §0.1 Corrections to `GATE_2_0_FINDINGS.md`

- **§E.2 is stale and superseded.** It states `client_user` is "storable
  today with zero enforced restriction behind it." That was true when
  written. `20260806000029_org_members_role_not_client_user.sql` (PR #4,
  merged) added `check (role <> 'client_user')` on `org_members`, proven by
  `supabase/tests/org_members_role_constraint.test.sql`. `client_user` can
  no longer be stored in `org_members` at all, by any writer, including
  `service_role`. This is now moot for a different reason than §E.2
  anticipated: under the now-settled §B (Option 2), a client was never
  going to hold an `org_members` row in the first place, so the constraint
  and the access model arrived at the same place from two different
  directions.
- **`lib/authz/index.ts`'s `client_user` row is now provably dead code,
  not merely "aspirational."** §E.2 and `docs/PERMISSIONS.md` both describe
  `client_user` as unenforced-but-legal. That undersold it: given (a) PR #4
  makes it illegal to store in `org_members` at all, and (b) Option 2 means
  clients never hold a main-project session to begin with, there is no
  reachable code path — today or under this spec — where
  `can('client_user', ...)` is ever evaluated against a real request.
  **This spec does not delete or repurpose that matrix row** (out of scope,
  and `lib/authz`'s own module header already disclaims it as
  pre-enforcement groundwork) but flags it here so a future cleanup pass
  doesn't mistake it for live, reachable design intent. The bridge layer
  designed in §3 below is an **independent, new authorization surface** —
  it does not read, extend, or delegate to `lib/authz`'s `client_user` row
  at all, because that matrix is scoped to `org_members`-based identity,
  which a client under Option 2 never has.
- **§E.3's open-verification-gap caveat is still substantively true, with
  one instance now closed.** This session (prior to this spec) fixed the
  one concretely-identified vacuous assertion §E.3 flagged
  (`tenant_isolation.test.sql`'s `application_documents` block). §E.3's
  broader claim — "not every assertion in every `*.test.sql` file has been
  individually re-derived as non-vacuous" — was never exhaustively
  re-audited and is not treated as resolved by that one fix. §6 below cites
  the *shape* of the anti-pattern that block used to have, not its current
  line numbers, since that specific file no longer shows it.
- No other §E-series item is contradicted by anything found during this
  spec's research. §E.1 (RLS is membership-only), §E.4 (audit trail has
  zero writers — see §4 below, which changes this claim's status for the
  first time), and §E.5 (`OrgContext.role` narrowing, no entitlements
  system) all still hold as stated.

## §1. Token model

### Hard requirements, addressed structurally

| Requirement | How this schema satisfies it |
|---|---|
| Server-side stored/validated tokens, not stateless JWTs | The bearer credential in the magic-link URL is a high-entropy random string generated at issue time. The database stores only `token_hash` (a salted hash of it). Validating a request means: look up the hash, confirm `status = 'active'` and `expires_at > now()`. There is no self-contained signed payload a client could forge or replay without a DB round trip — every use requires a live lookup, which is also what makes instant revocation possible (a stateless JWT cannot be revoked before its own expiry without an external denylist, which is just this table by another name). |
| Instant revocation, per-token and per-recipient | `client_access_tokens.status` transitions to `'revoked'` via a direct `UPDATE ... WHERE id = :token_id` (per-token) or `UPDATE ... WHERE recipient_email = :email AND application_id = :app_id AND status = 'active'` (per-recipient, since the partial-unique-active-token constraint below guarantees at most one row matches). Both are synchronous, take effect on the next lookup — no cache, no propagation delay. |
| Short expiry, explicit re-issue path | `expires_at` set at issue time (see §1's transition matrix — proposed default 14 days, chosen to match a realistic permit-review cycle rather than the main project's session `jwt_expiry` config, which governs a wholly different session type and is not reused here). Re-issue is not a mutation of the existing row — it is a new INSERT that atomically supersedes the old one (see transition matrix). |
| One token per recipient | Enforced by a **partial unique index**, not application logic: `unique (recipient_email, application_id) where status = 'active'`. At most one *active* token can exist for a given recipient+application pair at the database layer — re-issuing requires the old row to leave `'active'` status first (superseded/revoked), inside the same transaction. |
| Every access logged with token identity | `client_access_log` (§2) is an append-only ledger, one row per bridge-layer invocation, always carrying `token_id`. This is deliberately a *separate* ledger from the main project's `audit_logs` — see §4's reasoning for why those two ledgers have different scope and are not merged. |

### Token lifecycle transition matrix

State values: `issued`, `active`, `expired`, `revoked`, `superseded`.
(`issued` and `active` are the same row-state in practice — `issued` is the
instant of creation, `active` is that same state for the remainder of its
life until one of the three terminal transitions below fires. They are
listed separately because the matrix format requires naming the entry
state distinctly from its steady state, matching how the master prompt's
own §3.5 status matrix names an initial state separately from its
transitions.)

| From | To | Trigger | Who can trigger |
|---|---|---|---|
| *(none)* | `issued` → `active` | New token created for a recipient+application pair with no existing active row | Org staff, via the bridge layer's issuance operation (not enumerated in §3's client-facing operation set — this is a staff-facing operation, invoked from the main app, not from the client portal) |
| `active` | `expired` | `expires_at` passes | System — evaluated lazily at lookup time (`expires_at > now()` in the validation query), not by a scheduled job. No cron exists in this repo (`GATE_2_0_FINDINGS.md`'s own note on `jurisdiction_sources`' staleness applies the identical reasoning here: computed at read time, not written). A row can sit with `status = 'active'` past its `expires_at` until the next access attempt evaluates it — this is safe because every authorization check re-derives validity from `expires_at`, never trusts `status` alone for the active case. |
| `active` | `revoked` | Explicit staff action ("revoke this link") or org offboarding (bulk revoke by `org_id`) | Org staff (owner/`org_owner`/`platform_admin` tier, mirroring who can manage `org_members` today) via the bridge layer's staff-facing revocation operation. Never the recipient — there is no client account to self-serve a revoke from, by design (no client accounts in this gate). |
| `active` | `superseded` | A new token is issued for the same recipient+application pair before the old one expired or was revoked | System, as part of the atomic re-issue transaction — the old row's status flips to `superseded` in the same transaction that inserts the new `active` row, which is what lets the partial unique index hold without a race. |
| `expired` / `revoked` / `superseded` | *(none — terminal)* | — | No transition leaves any of these three states. Re-access always requires a brand-new `issued` row, never a resurrection of an old one. This is deliberate: it keeps `client_access_log` rows permanently attributable to the exact token-state-window they occurred in, with no ambiguity about whether a given row happened while the token was legitimately active. |

Every transition above is a plain `UPDATE` (or `INSERT` for the entry
transition) — `token_lifecycle_events` (§2) records each one as an
append-only row (`token_id`, `from_status`, `to_status`, `occurred_at`,
`triggered_by` — see §2 for how `triggered_by` is represented given the
same cross-project actor problem §4 solves for `audit_logs`).

### Issuance vs. the partial unique index (lazy/eager mismatch)

The `expired` transition is lazy — evaluated at read time, not written
eagerly — while the partial unique index (`... where status = 'active'`)
cares about the literal `status` column value, not the logically-current
one. Left unreconciled, that's a real bug: a token past its `expires_at`
but never read since would still occupy the uniqueness slot with
`status = 'active'`, and issuing a replacement would hit the unique
violation instead of superseding it.

This does not happen, because the issuance operation is specified to do
more than a bare `INSERT`. Inside a single transaction:

1. `select id, expires_at from client_access_tokens where recipient_email = :email and application_id = :app_id and status = 'active' for update` — the `for update` row lock is load-bearing: it's what makes two concurrent issuance attempts against the same recipient+application serialize instead of race, not the unique index alone (the index is the last-resort guarantee if this locking is ever bypassed, not the primary mechanism).
2. If a row was found, determine which terminal state actually applies before writing it: `expired` if that row's `expires_at <= now()`, `superseded` otherwise. This keeps `token_lifecycle_events` historically accurate — a token that had already lapsed before anyone re-issued to that recipient is recorded as having expired, not as having been superseded while still nominally active.
3. `INSERT` the new row with `status = 'active'`.

Because step 1's lock and step 2's transition happen in the same
transaction as step 3's insert, the partial unique index is never
violated by a legitimate re-issuance — the old slot is always vacated
first, deterministically, regardless of whether it was "really" still
active or just stale-active. The index remains valuable as the
backstop that catches any future code path that tries to skip this
sequence, not as the mechanism doing the reconciliation itself.

That "backstop, not mechanism" framing holds for re-issuance, where a
prior `active` row exists for step 1 to find and lock — but it is not
true for **first issuance** to a given recipient+application pair. When
no row exists yet, step 1's `select ... for update` locks nothing (there
is nothing to lock), and two concurrent first-issuance transactions for
the same recipient+application both see zero rows, both proceed to step
3, and both attempt the insert. Here the partial unique index is not a
backstop for a sequence that already prevented the race — it is the
**only** thing that prevents the duplicate, because there was no row for
`for update` to serialize against. This path is expected to lose the
race honestly at the index, not to be pre-empted by locking.

The issuance operation must therefore handle Postgres error `23505`
(unique violation) on this specific index
(`client_access_tokens_one_active_per_recipient`) as an expected outcome
of concurrent first issuance, not an unhandled exception surfaced to the
caller. On catching it: re-select the row that now exists for that
recipient+application with `status = 'active'` (the row the *other*
transaction just committed) and return that token's identity, rather
than retrying the insert (a retry would just re-observe the same
committed row and violate the index again) or surfacing the raw
constraint error to whoever called the issuance operation. Two staff
members concurrently issuing a link to the same recipient for the same
application is a real, if rare, scenario — the caller should get back
"here is the active token for this recipient" either way, not a 500.

## §2. Second-project schema

### Design constraint this section must hold to

The two Supabase projects share no FK space — a `references` clause in
project 2 cannot point at a row in project 1's Postgres instance, full
stop. Every pointer from project 2 back to project 1 (`application_id`,
`org_id`) is therefore a **bare, unenforced `uuid` column**, not a foreign
key. This has a real consequence spelled out here rather than glossed
over: **project 2's copy of `application_id`/`org_id` is a local
authorization *hint*, never the authoritative check.** The bridge layer
(§3) re-validates every one of those pointers against a live read of the
main project on every single invocation — not just at token-issue time.
Concretely: `getApplicationSummary(token)` does not trust
`client_access_tokens.application_id` and hand back whatever project-2 row
matches it; it takes that id, does a fresh `is_org_member`-equivalent
lookup against the *main* project (as service-role, which bypasses RLS, so
the check is the bridge code's own explicit `application_id` existence
check, not RLS) before returning anything. If the main-project application
was ever deleted, the stale pointer in project 2 fails this live check and
the bridge returns "not found," not a stale cached answer. This is not a
hypothetical to future-proof against: `permit_applications_delete`
(`20260806000006`) plus `authenticated`'s table-level `DELETE` grant
(`20260806000011`) are both live and unrevoked today — any org owner can
hard-delete a `permit_applications` row right now, through the existing UI,
cascading to every FK-linked child row (`application_documents`'s own
`DELETE` path was closed by `20260806000024`, but `permit_applications`'
was not). The re-check above is what defends against that live path today,
not a forward-looking precaution against a possibility (`GATE_2_0_FINDINGS.md`
§K.3, closed by this correction). This is the direct answer to "how
does a token record link to `clients`/`permit_applications` given no
shared FK space": *it doesn't, structurally — it carries an ID that is
re-verified live, every time, against the project that actually owns it.*

`client_access_tokens` is **not** linked to `clients` at all. The
recipient is captured as free-form `recipient_email`/`recipient_name` at
issue time by org staff — it is not required to equal any `clients.email`
value, because the recipient of a given application's link (e.g. a
property owner, a site contact, a lawyer) may not be the same person as
the org's own CRM "client of record." Forcing that equality would be a
false constraint the product doesn't actually have.

### Tables (second project)

```sql
create type token_status as enum ('active', 'expired', 'revoked', 'superseded');

-- The bearer credential is never stored — only its hash. Validation is
-- "hash the presented token, look up by hash, check status/expiry,"
-- identical in shape to a password-hash check, not a JWT-verify.
create table client_access_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Cross-project pointers. Bare, not FKs — see design-constraint note
  -- above. Both required: application_id scopes what the token can reach,
  -- org_id exists specifically so an org-offboarding bulk revoke
  -- ("UPDATE ... WHERE org_id = :x") doesn't require joining back through
  -- every application_id first.
  application_id uuid not null,
  org_id uuid not null,

  -- Recipient identity, stored twice on purpose. recipient_email is the
  -- normalized join/uniqueness key (lowercased, trimmed) -- see the
  -- forward-path self-check below for exactly why this CHECK exists:
  -- without it, the future client_accounts join is a fuzzy-match problem,
  -- not an equality join. recipient_email_display is exactly what staff
  -- typed, unmodified -- outbound mail and any "we sent this to X"
  -- confirmation shown back to staff should render what was entered, not
  -- the normalized form. The second CHECK ties the two together
  -- structurally, not by convention: recipient_email_display can only
  -- ever be a case/whitespace variant of recipient_email, never an
  -- independently-typed second value that could silently drift from the
  -- real recipient.
  recipient_email_display text not null,
  recipient_email text not null check (recipient_email = lower(btrim(recipient_email))),
  check (lower(btrim(recipient_email_display)) = recipient_email),
  recipient_name text,

  token_hash text not null,
  status token_status not null default 'active',

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,

  -- Exactly-one-representation pattern (same shape as §4's audit_logs
  -- design below, applied here first because this table needed it before
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

-- At most one ACTIVE token per recipient+application — the DB-level
-- expression of "one token per recipient" from §1.
create unique index client_access_tokens_one_active_per_recipient
  on client_access_tokens (recipient_email, application_id)
  where status = 'active';

create index client_access_tokens_application_id_idx on client_access_tokens (application_id);
create index client_access_tokens_org_id_idx on client_access_tokens (org_id);

-- Append-only. Every lifecycle transition from §1's matrix, one row each.
create table token_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references client_access_tokens(id),
  from_status token_status,
  to_status token_status not null,
  occurred_at timestamptz not null default now(),
  -- Same non-FK actor pair as client_access_tokens.revoked_by_* above,
  -- reused here rather than re-invented, since every transition this table
  -- records has the identical "staff or system, never the recipient"
  -- actor shape §1's matrix already established.
  triggered_by_org_user_id uuid,
  triggered_by_system boolean not null default false,
  check ((triggered_by_org_user_id is not null) <> triggered_by_system)
);

-- Append-only. Every bridge-layer invocation, successful or denied. This
-- is the accountability ledger §1 requires ("every access logged with
-- token identity") -- distinct in purpose from the main project's
-- audit_logs (see §4's reasoning for why these are not merged).
create table client_access_log (
  id uuid primary key default gen_random_uuid(),
  -- Nullable as of 20260815000001 (a 2.4-implementation-discovered gap,
  -- documented in full just below the table) -- NOT NULL was unsatisfiable
  -- for the token_not_found case this same table's detail comment and §3's
  -- failure-mode section both require logging: there is no row to
  -- reference when the hash lookup finds nothing. NULL is reserved
  -- exclusively for that pre-resolution case, enforced by the bridge
  -- layer's own code (lib/bridge/client-portal.ts), not by an additional
  -- CHECK.
  token_id uuid references client_access_tokens(id),
  operation text not null,        -- one of §3's enumerated operation names
  resource_type text,             -- e.g. 'application_documents', null for token-scoped reads with no sub-resource
  resource_id text,                -- bare id string, cross-project, same non-FK reasoning as above
  outcome text not null check (outcome in ('success', 'denied')),
  -- Populated only when outcome = 'denied' -- the granular reason
  -- (token_not_found / token_expired / token_revoked /
  -- application_not_found / ...) that §3's failure-mode section
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

-- 2.4-implementation-discovered gap, fixed by migration 20260815000001
-- (supabase-client-portal/supabase/migrations/), additive per this repo's
-- own established convention for post-hoc schema fixes (identical shape to
-- 20260806000032's fix for K.1 -- a new ALTER migration, not an edit to the
-- already-shipped 20260814000001 that first defined this table). Not
-- caught by GATE_2_0_FINDINGS.md's K/L checks (grepped: zero hits for
-- "token_not_found" anywhere in that file) -- found only once 2.4 tried to
-- actually write resolveToken()'s logging call: as originally shipped,
-- `token_id uuid not null references client_access_tokens(id)` directly
-- contradicted two things this same spec already states -- this table's
-- own "detail" column comment above (token_not_found is one of the
-- enumerated detail values) and §4's guarantees-comparison section, which
-- explicitly rejects splitting "resolved vs. unresolved" events across two
-- tables in favor of keeping "every token-driven access, resolved or not,
-- successful or denied" in this one ledger. A NOT NULL FK cannot reference
-- a row that was never found to exist, so a token_not_found attempt could
-- not have been logged at all under the original constraint -- silently
-- breaking both promises the first time a malformed or unrecognized token
-- was ever presented. Fixed by dropping NOT NULL; the FK itself is
-- untouched, so every row that does carry a token_id still has to
-- reference a real one.

-- Project 2 has no access to the main project's forbid_update_delete()
-- function -- separate Postgres instances share no function catalog, the
-- same reason they share no FK space (see the design-constraint note
-- above). Re-defined here, identical in behavior, so these two ledgers
-- get the same tamper-resistance audit_logs has in the main project: this
-- trigger blocks UPDATE and DELETE for every role, including this
-- project's own service_role, which would otherwise have unrestricted
-- access to these two tables (see §4's guarantees comparison for why this
-- specific gap mattered enough to fix here rather than leave implicit).
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
-- project has no client-facing Supabase Auth session at all (see §3's
-- closing note) -- every reader/writer is the bridge layer running as
-- this project's own service_role, which bypasses RLS. RLS is enabled
-- anyway (defense-in-depth, matches this codebase's own convention of
-- enabling RLS even on tables with no authenticated-role policy, e.g.
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
```

### Forward-path self-check: the `client_accounts` migration

The requirement: prove a future gate can add real client accounts without
reshaping any existing table, and without those accounts starting empty —
they must inherit the token/access history already accumulated for that
recipient.

**First draft attempt (rejected):** a `client_accounts` table with
`email text unique`, plus a backfill `update client_access_tokens set
client_account_id = (select id from client_accounts where email =
client_access_tokens.recipient_email)`. This is where the self-check
earns its keep: that join is only reliable if every historical
`recipient_email` value was captured in a single, consistent normal form.
If staff-entered emails varied in case or trailing whitespace across two
years of issued tokens (`Jane@Example.com` vs `jane@example.com `), the
equality join silently fails to match rows that are actually the same
person, and the new accounts *would* start partially empty — exactly the
failure mode the instruction warned about. That is a real defect in the
schema as first drafted, not a hypothetical one.

**Resolution, folded back into §2 above:** the `check (recipient_email =
lower(btrim(recipient_email)))` constraint on `client_access_tokens` (already
included in the CREATE TABLE above) makes this a non-issue by construction
— every row, from the very first one this gate ever inserts, is guaranteed
normalized. The forward migration's join is then a plain equality, proven
to work against every historical row, not just newly-issued ones.

The forward migration, written out in full against the schema above:

```sql
-- Future gate (not this one). Additive only, per the master prompt's
-- global rule -- no existing column on client_access_tokens changes name,
-- type, or meaning.
create table client_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email))),
  -- Carries forward the same normalized/display split client_access_tokens
  -- already has, for the same reason: the join key stays a clean
  -- equality, and a human still sees a real casing somewhere.
  email_display text not null,
  display_name text,
  created_at timestamptz not null default now()
);

alter table client_access_tokens add column client_account_id uuid references client_accounts(id);

-- Backfill: create one account per distinct historical recipient, then
-- attach it. Works cleanly BECAUSE recipient_email has been normalized
-- since day one -- this is the exact step that would have needed a fuzzy
-- dedup pass (or, worse, silently mis-joined) under the first-draft schema.
-- email_display is seeded from the MOST RECENTLY issued token for that
-- normalized address (order by issued_at desc) -- an arbitrary but
-- reasonable tiebreak (freshest is most likely to reflect how staff
-- currently spell it), not a claim that every historical casing variant
-- is preserved.
insert into client_accounts (email, email_display)
select distinct on (recipient_email) recipient_email, recipient_email_display
from client_access_tokens
order by recipient_email, issued_at desc
on conflict (email) do nothing;

update client_access_tokens t
set client_account_id = a.id
from client_accounts a
where a.email = t.recipient_email
  and t.client_account_id is null;

-- New tokens going forward can then be issued directly against an
-- existing client_account_id (application code change, out of scope
-- here) -- but every token issued under this gate, before accounts
-- existed, is now attached to the account that inherits its full history,
-- not a fresh empty one. token_lifecycle_events and client_access_log
-- need no migration at all: they key off token_id, which is unaffected by
-- this change, so their history is inherited transitively through
-- client_access_tokens without touching either table.
```

This holds. No existing table's column set, type, or constraint changes
shape — `client_accounts` and one nullable FK column are the only new
surface, and the backfill is a plain equality join with no ambiguity. The
schema in §2 is not revised further after this check.

## §3. Bridge layer contract

This is the complete, enumerated set of operations the client-portal
surface may invoke. It is the security boundary itself, not a general
data API — no operation here is a passthrough query; each one is a
specific, narrow, hand-written projection.

| Operation | Inputs | Authorization check | Columns/fields returned |
|---|---|---|---|
| `resolveToken` | raw token string | Hash lookup finds a row; `status = 'active'`; `expires_at > now()` | `applicationId`, `orgName`, `propertyAddressSummary` (see K.4 resolution below — a bridge-computed prefix of `permit_applications.project_address`, not a city/province decomposition), `recipientName` — enough to render "Welcome, Jane — viewing your application for 123 Main St." No internal ids beyond `applicationId` (needed by the client app for subsequent calls). |
| `getApplicationSummary` | token | Same as `resolveToken`, plus live re-check against the main project that `application_id` still exists (see §2's design-constraint note) | `permitStatus`, `projectTitle`, full property address (`permit_applications.project_address`, verbatim — see K.4 resolution below), `statusHistory` (from `application_status_history`: `to_status`, `created_at` only — not `changed_by`, which is an internal actor id with no meaning to a client) |
| `getReadinessChecklist` | token | Same as `getApplicationSummary` | Array of `{ title, isRequired, status }` from `readiness_checklist_items`, scoped to the token's `application_id` |
| `listDocuments` | token | Same as `getApplicationSummary` | Array of `{ id, originalFilename, docKind, status, uploadedAt }` from `application_documents`. Deliberately excludes `storage_path` (never handed to client-tier code — see `getDocumentDownloadUrl` below) and `sha256`/`byte_size` (internal integrity metadata, no client-facing purpose) |
| `getDocumentDownloadUrl` | token, `documentId` | Same as above, plus `documentId` must belong to this token's `application_id` and the document must not be archived | A single short-TTL (≤15 min, matching the existing convention cited in the master prompt §3.6/Phase 0 §M) signed URL. Nothing else. |
| `uploadDocument` | token, file bytes, `docKind` | Same scope check as `listDocuments`; MIME/size validated via the existing `lib/storage/documents.ts` (`isAllowedMimeType`, `MAX_FILE_SIZE_BYTES`) — reused directly, not reimplemented, since the bridge layer is PermitField's own backend code with access to both projects' credentials, not a separate deployable artifact | No data returned beyond `{ documentId, status: 'pending' }` — a bare acknowledgment, not the full row |

### K.4 resolution: `propertyAddressSummary` and "full property address" sourcing

`GATE_2_0_FINDINGS.md` §K.4 (extended to a second call site by §L.2) found
this table internally inconsistent — `resolveToken`'s own cell called
`propertyAddressSummary` "(city/province only)" while its own illustrative
rendering ("...viewing your application for 123 Main St") is street-level —
and found that neither reading has a clean, always-reachable schema source:
the only structured city/province split
(`properties.city`/`properties.province_code`) is reachable only via
`permit_applications.project_id -> projects.property_id -> properties`, and
`project_id` is deliberately, permanently nullable
(`supabase/migrations_blocked/20260806000023b`'s own header) — a live,
currently-open code path (`createApplicationAction`,
`app/(app)/applications/new/actions.ts`) inserts `project_address` without
ever setting `project_id`, so a `properties` join is not guaranteed to exist
for every token-eligible application.

Resolved here, before 2.4 writes the query, per K.4's own recommendation:
both fields read `permit_applications.project_address` — a single, always-
present, `not null` free-text column — never the `properties` join.
`getApplicationSummary`'s "full property address" is that column, verbatim,
unparsed. `resolveToken`'s `propertyAddressSummary` is a bridge-computed
prefix of the same column (the text up to and including the first comma, or
the whole string if it contains none), not a city/province decomposition —
the table's own parenthetical above is corrected to say so, and the
illustrative "123 Main St" rendering is kept as-is, since a street-level
prefix is what that example actually shows.

Everything above is read-scoped to a single `application_id` baked into
the token itself — there is no operation that accepts an arbitrary
`application_id`/`org_id` parameter from the caller. This is what makes
the set enumerable and auditable: a request cannot ask for a different
application by changing a parameter, because the only application it can
ever reach is the one its token was issued against.

### Failure mode: what a denied or broken request sees

Every operation above collapses every non-success case into one generic
response — `{ error: 'link_unavailable' }` — for all of: token hash not
found, `status != 'active'`, `expires_at` already passed (the lazy check),
and, for every operation except `resolveToken`, the live main-project
existence re-check (§2's design-constraint note) failing because the
application was deleted or the org offboarded. None of these is
distinguished in what the caller receives. A recipient holding a merely-
old link and a recipient whose access was explicitly revoked because the
underlying application is gone see the identical response.

This is the same principle this repo already applies one layer down, not
a new one invented for this spec: `20260806000011_grants.sql` grants
`anon` a bare `SELECT` specifically so RLS produces a correct empty result
"instead of a Postgres error that would leak table existence/structure
via its error message" (that migration's own words). A differentiated
response here would leak the same class of thing one layer up — "this
application was deleted," "your access was revoked," and "this link is
simply old" are three different facts about the org's internal state,
and the only audience for that distinction (an attacker or a stale-link
holder who is no longer the intended recipient) is exactly the audience
it shouldn't be disclosed to.

The distinction is not discarded, only kept out of the response: every
attempt writes a `client_access_log` row with `outcome = 'denied'` and
`detail` set to the specific reason (`token_not_found` /
`token_expired` / `token_revoked` / `application_not_found` / ...).
Staff investigating "why did my client say the link doesn't work" read
that column — through the bridge layer, since project 2 has no
staff-authenticated role of its own to grant a native RLS read policy to
(see §4's guarantees comparison for the full reasoning on that point).

### The structural enforcement mechanism (§C's discipline-vs-mechanism gap)

`GATE_2_0_FINDINGS.md` §C flagged that, under Option 2/3, the projection
layer is TypeScript, not SQL, and is therefore "discipline-dependent"
unless paired with something enforceable. Two mechanisms, not one,
close this gap — a single lint rule alone is a convention with teeth,
not a wall:

1. **Module boundary, lint-enforced.** All six operations above live in
   exactly one module (e.g. `lib/bridge/client-portal.ts`). A custom
   ESLint rule (`no-restricted-imports` configured against the
   second-project service-role client constructor, scoped to `overrides`
   for every path except that one file) fails the build if any other file
   imports it. This is the same class of mechanism the master prompt's
   §5 test categories already expect this repo to have for other
   boundaries — codified as a CI-checked rule, not a comment telling
   future authors not to do it.
2. **Credential physical isolation, deployment-enforced.** The second
   project's `service_role` key is not present in the main Next.js app's
   general server environment at all — it is scoped to whichever deploy
   target runs `lib/bridge/client-portal.ts` (a separate serverless
   function group / separate env-var scope). Even a compromised Server
   Action elsewhere in the main app cannot read a credential that was
   never provisioned to its runtime, regardless of what the lint rule
   catches at build time. This is the second, independent layer — the
   lint rule stops an accidental new import; credential isolation stops
   a deliberate one that bypassed the lint rule (a disabled-rule comment,
   a build run with `--no-verify`, etc.).

Both are enforceable and checkable (the lint rule by CI, the credential
scoping by inspecting the deploy config) — neither depends on a future
author remembering a written rule.

**2.4 addendum: the lint rule's exemption list has two entries, not one.**
As implemented, `lib/bridge/client-portal.ts`'s own live-Supabase test file
(`lib/bridge/client-portal.live.test.ts`, §6's test-plan item (a)/(b)) is
also exempted from the `no-restricted-imports` rule above. This is not a
second production importer — that file writes fixture rows directly into
`client_access_tokens` (deliberately mismatched `application_id`/`org_id`
pairs, each lifecycle status, the lazy-expiry case) specifically because
those states cannot be reached by calling the bridge module's own exported
functions, the same reason `supabase/tests/*.test.sql` fixtures write
directly to tables no application code writes to. `eslint.config.mjs`'s
`clientPortalServiceClientRestriction` documents this narrowing inline; it
does not change the guarantee mechanism 1 provides (no *route handler,
Server Action, or other application module* may import the credential),
only which files may.

### Current status of the two mechanisms (K.5/L.1) — recorded before any 2.4 code was written

As of the start of sub-phase 2.4's implementation branch, only mechanism 1
(the lint rule) is buildable. Mechanism 2 (credential physical isolation)
cannot exist yet, and this is stated here plainly rather than left implied
as already covered by the "two mechanisms, not one" framing above.

`GATE_2_0_FINDINGS.md` §K.5 and §L.1 both confirm the same underlying fact
by direct repo check, not inference: there is no deploy target of any kind
in this repo, for the client-portal bridge or for the main app it would sit
beside. No `vercel.json`, no "deploy"/"vercel" step in
`.github/workflows/ci.yml`, no `output` mode set in `next.config.ts`, no
serverless function group, no separate env-var scope. §3's mechanism 2 text
above describes credential isolation as depending on "whichever deploy
target runs `lib/bridge/client-portal.ts`" — that target has no referent
today. This is not a gap specific to the second project or the client
portal; the main app's own project-1 `service_role` key
(`lib/supabase/service-client.ts`) is equally un-isolated, for the identical
reason — there is nowhere to isolate either credential *to*.

**The boundary today is single-layer, not two-layer.** The lint rule
(module-boundary enforcement, restricting which file may import the
second-project `service_role` client constructor) is the entire enforced
boundary between the bridge layer and the rest of the app. It is real and
worth building regardless, and 2.4 builds it. But it is a single,
disableable, build-time-only convention — not backed by a second,
independent, deployment-enforced layer, because that layer has nothing to
attach to yet.

**Binary trigger for when this must change.** Before any real,
non-local project-2 `service_role` credential is provisioned into any
environment reachable by the main app's runtime — staging included, not
just production — mechanism 2 must exist first, or the single-layer state
above must be re-justified in writing at that time. A staging deploy is not
exempt from this trigger merely for being staging: "any environment
reachable by the main app's runtime" is the actual boundary, and staging
sits inside it. Until that trigger fires, this spec records the gap rather
than treating §3's two-mechanism framing as already achieved.

## §4. `audit_logs` migration design (Option 2, path b)

Current schema (`20260806000018`, verified live, unchanged since):

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  actor_role org_role not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  ip inet,
  user_agent text,
  occurred_at timestamptz not null default now()
);
```

`actor_user_id not null references auth.users(id)` cannot be satisfied by
a client's identity, which lives entirely in the second project — there is
no row in this project's `auth.users` a client-triggered action could
reference. Per §D's path (b):

```sql
alter table audit_logs alter column actor_user_id drop not null;
alter table audit_logs alter column actor_role drop not null;

-- Non-FK by necessity -- the referenced identity (a client_access_tokens
-- row) lives in the second project, same cross-project reasoning as
-- §2's application_id/org_id pointers. external_actor_label is a
-- denormalized snapshot of the recipient identity at write time, so an
-- audit_logs row stays human-readable even if the second project's token
-- row is later deleted/rotated -- audit_logs never re-derives a live
-- join back to project 2 to render itself, matching how before_summary/
-- after_summary already snapshot state rather than re-querying it.
alter table audit_logs add column external_actor_id text;
alter table audit_logs add column external_actor_label text;

-- actor_role must travel with actor_user_id, not float free -- dropping
-- not null on both columns (above) without also tying them together here
-- would leave a row with actor_user_id populated and actor_role null as
-- legal, silently losing the role attribution every internal audit row
-- has always carried. Both internal columns are required together, both
-- external columns are required together, never a mix.
alter table audit_logs add constraint audit_logs_actor_exactly_one_populated
  check (
    (actor_user_id is not null and actor_role is not null and external_actor_id is null)
    or
    (actor_user_id is null and actor_role is null and external_actor_id is not null)
  );

alter table audit_logs add constraint audit_logs_external_actor_label_requires_id
  check (external_actor_label is null or external_actor_id is not null);
```

**Representation of the external actor.** The user's instruction is
explicit: the external actor is a recipient, not an account — this gate
has no `client_accounts` table (that's §2's forward path, not built here).
`external_actor_id` stores the second project's `client_access_tokens.id`
(as text — the token, not a person, is the only stable identity that
exists at this point in time). `external_actor_label` stores a snapshot of
`recipient_email_display`/`recipient_name` captured at write time —
`_display`, not the normalized `recipient_email`, deliberately: this column
exists so a human reviewing `audit_logs` sees the identity as it was
actually entered/shown, not a lowercased/trimmed join key, matching why
§2 keeps the two columns separate in the first place (the normalized form
is for uniqueness and matching, the display form is for anything a person
reads). This is
consistent with treating the *token* as the accountable unit throughout
this spec (§1's "every access logged with token identity" is phrased the
same way) rather than inventing a second, parallel person-identity concept
that doesn't exist yet.

**This migration is additive and non-behavior-changing for every existing
row.** Every current `audit_logs` row already has `actor_user_id`
populated, so it already satisfies the new CHECK — dropping `not null`
only widens what's legal going forward, it doesn't touch existing data.
The existing `audit_logs_insert` RLS policy (`is_org_member(org_id) and
actor_user_id = auth.uid()`) is untouched: external-actor rows are never
written by an `authenticated` session (clients never hold one under
Option 2), only by the bridge layer running as `service_role`, which
bypasses RLS entirely — no policy change is required for this migration
to be safe.

**Does this gate wire up `writeAuditLog()`?** Yes, for exactly one call
site, and the scope is deliberately narrow:

- `uploadDocument` (§3) — a mutation of org data by an external actor —
  gets an `audit_logs` row (`action = 'client_document_upload'`,
  `entity_type = 'application_documents'`, `external_actor_id` populated).
  Mutations already get audited/history-tracked everywhere else in this
  schema (status transitions, readiness overrides) — an external-triggered
  mutation is not a special case for that principle, if anything it's the
  case that principle exists for.
- The five **read** operations (`resolveToken`, `getApplicationSummary`,
  `getReadinessChecklist`, `listDocuments`, `getDocumentDownloadUrl`) do
  **not** write `audit_logs`. They write `client_access_log` (§2) instead.
  This is not justified by precedent (an earlier draft of this section
  cited `PHASE_0_FINDINGS.md` §M.3's "downloads aren't audit-logged"
  convention; that's withdrawn as a justification here — precedent isn't a
  reason, it's just a fact about what the code currently does elsewhere).
  The actual justification is below, stated on guarantees.

**Guarantees comparison: `audit_logs` vs. `client_access_log`.** Both
tables are append-only ledgers of things that happened. Whether routing
client-portal reads to the second one is a downgrade depends entirely on
whether the two tables actually offer the same guarantees. Stated
side by side, as of this section's schema (§2, §4 above):

| Guarantee | `audit_logs` (project 1) | `client_access_log` (project 2) |
|---|---|---|
| Append-only / tamper-resistant | `audit_logs_append_only` trigger (`forbid_update_delete()`, `20260806000018`) — fires on `BEFORE UPDATE OR DELETE` for every role, including `service_role` (a trigger is not an RLS mechanism, so `BYPASSRLS` does not bypass it). | Same mechanism, independently defined (§2's `forbid_update_delete()` — necessary restatement, not reuse, since separate Supabase projects share no function catalog). Attached to `client_access_log` identically. **Equivalent.** |
| Durability | Standard Postgres table, project 1's instance. | Standard Postgres table, project 2's instance. Same durability class; different physical database. **Equivalent** (not identical infrastructure, but no weaker). |
| Write-path integrity | Two paths: `authenticated` may insert only a row self-attributed to `auth.uid()` (`audit_logs_insert` policy); `service_role` may insert anything (bridge layer, bypasses RLS, restricted instead by §3's structural mechanism — lint boundary + credential isolation). | One path only: `service_role` (bridge layer) — §2 grants `insert` to no other role, and project 2 has no `authenticated`-equivalent session for a client or staff member to hold in the first place. **Not weaker** — arguably tighter, since there is no self-attributed-write path to also reason about. |
| Read-restriction, enforced by the DB engine | `audit_logs_select` policy: `for select to authenticated using (can_read_audit_logs(org_id))` — native RLS, evaluated by Postgres itself against the connected session's `auth.uid()`. | **None exists, structurally.** Project 2 has no staff-authenticated role at all — under Option 2 (§0), org staff never hold a session in project 2; only the bridge layer's `service_role` credential connects to it, and §3 already establishes that credential is deliberately not provisioned to the general app runtime. There is no session for a `to authenticated using (...)` policy to attach to. **Not equivalent — genuinely weaker on this one axis, and this spec states that plainly rather than obscuring it.** |

Three of four guarantees are equivalent (the append-only fix in §2 and the
grant fix in §2 are what make this table true rather than aspirational —
both were gaps in an earlier draft, closed above). The fourth,
read-restriction, is not, and cannot be made equivalent by moving these
rows into `audit_logs` either — a `token_not_found` or malformed-token
denial (§3's failure-mode section) has no resolvable `application_id` or
`org_id` at all; `audit_logs.org_id` is `not null references
organizations(id)`, so that class of event is **structurally unwritable**
to `audit_logs` regardless of this design choice, not just conventionally
routed elsewhere. Any design keeps at least pre-resolution denials in a
separate table. Given that a separate table is unavoidable for part of
the event set, this spec keeps the whole set together — every token-driven
access, resolved or not, successful or denied — in one ledger, rather than
splitting resolved reads into `audit_logs` and unresolved ones into
`client_access_log`, which would force anyone investigating a single
recipient's access history to reconstruct it from two tables with two
different join keys instead of one.

The read-restriction gap is real and is not closed by this gate. Today,
staff can only read `client_access_log` by holding project 2's raw
credentials directly (the same credential §3 keeps out of the general app
runtime) — there is no staff-facing bridge-layer *read* operation
enumerated in §3's operation table, only the client-facing write-shaped
operations. Building one (a staff-authenticated endpoint in the main app
that calls into the bridge layer to read `client_access_log` filtered by
`org_id`, enforcing the org-membership check in application code the same
way `getApplicationSummary`'s existence re-check already does) is future
work, listed in §7 as explicitly undecided/out of scope for this gate —
not silently assumed to exist.

This changes `docs/PERMISSIONS.md`'s "Current status" claim that
`writeAuditLog()` has zero call sites — the section explicitly says a
future phase's report should update it when the first call site lands.
This gate's own delivery report must do that; it is not done by this
document.

## §5. Document upload/download

Routed exclusively through the bridge layer (`getDocumentDownloadUrl`,
`uploadDocument` from §3) — never a direct storage-bucket grant to a
client session, because there is no client session against either
project's Storage API to grant one to. Clients never receive a Supabase
SDK key, browser-side, for either project — every document interaction is
server-mediated, full stop. This also means **no new `storage.objects` RLS
policy is needed for `anon`/`authenticated` on the client-facing side at
all** — the existing storage RLS (`20260806000013`) already scopes to
`authenticated` org members; the bridge layer's `service_role` storage
access bypasses it the same way every other `service_role` operation in
this schema does.

**Known gap, carried forward exactly as flagged when discovered (PR #3's
detour):** `20260806000015_service_role_grants.sql` grants `service_role`
only `select, update` on `application_documents` — no `insert`. That grant
was scoped deliberately to what `lib/inngest/functions/{extract,audit}.ts`
actually perform (grep-verified at the time), not issued speculatively.
`uploadDocument` is the first `service_role` caller in this codebase that
needs to INSERT into `application_documents`, so the gap the finding
flagged is now load-bearing, not hypothetical.

**Grant change required:**

```sql
grant insert on application_documents to service_role;
```

**Blast radius:** one `GRANT` statement, additive, no RLS policy touched
(`service_role` has `BYPASSRLS`, so `application_documents_insert`'s
`is_org_member`-gated `with check` is irrelevant to it either way — the
grant is the entire enforcement surface for this specific capability,
consistent with `20260806000015`'s own header-comment finding that GRANT
and RLS are separate layers for `service_role`). The only other
`service_role` callers against this table are the Inngest extract/audit
functions, which — per the same grep this spec re-confirmed — call
`select`/`update` only; neither gains any new capability it uses. No
existing behavior changes for any existing caller. The new capability is
reachable only through `uploadDocument`, which is itself gated by
`isDocumentsEnabled()`-style feature flag discipline (§6) before it has
any caller at all.

MIME allow-list and the 25 MB/file cap are enforced by reusing
`lib/storage/documents.ts` directly (`isAllowedMimeType`,
`MAX_FILE_SIZE_BYTES`) inside `uploadDocument` — not reimplemented, and
not merely mirrored in a second copy that could drift. The storage path
convention (`${orgId}/${applicationId}/${sha256}-${filename}`) is reused
unchanged; the bridge layer computes it the same way `buildStoragePath()`
already does, since it has legitimate access to both `orgId` and
`applicationId` post-authorization-check.

## §6. Sub-phase sequencing 2.1–2.5

Test discipline for every isolation/authorization assertion below: control-
then-assert, matching `dashboard_queries.test.sql` Part 1's pattern (fixture
inserted and a **non-zero/expected-nonempty control check run under a
role that bypasses the boundary being tested**, before the boundary is
engaged) — not the anti-pattern of asserting "0 rows" or "insert fails"
with no proof the alternate outcome was ever reachable. (That anti-pattern
used to be literally present in this repo's `tenant_isolation.test.sql`
`application_documents` block; it was fixed earlier in this same
engineering thread, so today's file no longer shows it at any citable line
number — the shape to avoid is what's being named here, not a live example
still in the tree.)

| Sub-phase | Scope | Blast radius | Test requirements |
|---|---|---|---|
| **2.1** | Stand up `client_access_tokens`, `token_lifecycle_events`, `client_access_log` in the **second, new** Supabase project | Zero — a different database entirely; nothing in the main project's schema, RLS, or grants changes | (a) Token issue → hash-validate round trip. (b) Partial unique index (`...one_active_per_recipient`) actually blocks a second concurrent active row: control = drop the index, insert two active rows for the same recipient+application, confirm both persist; assert = restore the index, repeat, confirm the second insert fails specifically via that index's name — same control-then-assert shape as `org_members_role_constraint.test.sql`. (c) Every transition in §1's matrix exercised at least once, each recorded as one `token_lifecycle_events` row. |
| **2.2** | Main-project `audit_logs` migration (§4): nullable `actor_user_id`/`actor_role`, new `external_actor_id`/`external_actor_label` columns, exactly-one-populated CHECK | Touches one existing table, additive-only (`alter column drop not null` + `add column` + `add constraint`). Every existing row already satisfies the new CHECK (verified by construction, not assumed — the migration should include a post-add `select count(*) from audit_logs where not (...)` sanity assertion returning 0 before commit, same discipline `20260806000024`'s own constraints use). No RLS policy changes. | Control-then-assert on the CHECK specifically: (a) control — with the constraint dropped, insert a row with both `actor_user_id` and `external_actor_id` null, and a row with both populated; confirm both succeed. (b) assert — restore the constraint, repeat both inserts, confirm both are rejected by name (`audit_logs_actor_exactly_one_populated` in the error text), not just "some check_violation." (c) confirm a normal internal-actor insert (only `actor_user_id` populated) still succeeds unchanged — this is the regression check proving the migration didn't silently break the existing, only-ever-used path. |
| **2.3** | `grant insert on application_documents to service_role` (§5) | Single GRANT, additive. No RLS change. Inngest extract/audit functions unaffected (grep-reconfirmed: `select`/`update` only). | Control-then-assert, inverted from the usual shape since this is a new capability, not a restriction: control = as `service_role`, attempt an INSERT into `application_documents` *before* this migration applies (or inside a transaction with the grant rolled back), confirm it fails with `permission denied` — proving the gap was real, not assumed. Assert = with the grant applied, the identical insert succeeds. Additionally confirm `service_role`'s pre-existing `select`/`update` capability on this table is unchanged (regression check). |
| **2.4** | Bridge layer module (`lib/bridge/client-portal.ts`) implementing the five read operations from §3; new feature flag (`PERMITFIELD_FF_CLIENT_PORTAL`, default off, `lib/flags.ts`) | New code path only — no existing route or Server Action modified. Off by default per the master prompt's global flag rule. | (a) Per-operation authorization: a valid, active token succeeds; the same token after being moved to `expired`/`revoked`/`superseded` fails — control-then-assert directly analogous to `tenant_isolation.test.sql`'s cross-tenant shape, but scoped to token state instead of org membership (control = the same token succeeds *before* the state change; assert = it fails *after*, proving the state check is what's blocking it, not some unrelated failure). (b) Cross-application scope: a valid token for application A cannot retrieve data for application B, even if `application_id` were somehow supplied — since no operation accepts one as a parameter (§3), this is proven by confirming the operation signatures themselves carry no such parameter, not by a runtime probe against a nonexistent input. (c) The structural-enforcement mechanism (§3) is itself tested: a CI-run check (lint rule execution, or a grep-based test asserting the second-project service-role client constructor has exactly one importer in the repo) — the mechanism must be verified to actually fire, not just documented as existing. |
| **2.5** | `uploadDocument` operation; first real call site for `writeAuditLog()` (§4) | Depends on 2.2 (schema) and 2.3 (grant) both being live. New code path, flag-gated same as 2.4. `docs/PERMISSIONS.md`'s "Current status" section must be updated in this sub-phase's delivery report to remove the "zero call sites" claim for `writeAuditLog()` — leaving it stale would repeat exactly the kind of drift §0.1 flagged in `GATE_2_0_FINDINGS.md` itself. | (a) MIME/size rejection reuses `lib/storage/documents.ts` — a disallowed MIME type or oversized file is rejected before any DB write, proven by a fixture upload attempt of each kind. (b) A successful upload produces exactly one `application_documents` row (via the now-granted `service_role` INSERT) **and** exactly one `audit_logs` row with `external_actor_id` populated and `actor_user_id` null — control-then-assert reusing 2.2's constraint-drop/restore technique, but asserted against a real bridge-written row this time, not a synthetic fixture, closing the loop between the schema test (2.2) and the code that actually exercises it. (c) Confirm the five read operations from 2.4 still write zero `audit_logs` rows when exercised — a regression check proving §4's "reads go in `client_access_log` only" decision holds in the implemented code, not just in this document. |

## §7. Explicitly undecided

Per the instruction to say so rather than assume the convenient branch. Each item below carries a
status designation added by the `GATE_2_0_FINDINGS.md` §N closure retrofit, distinguishing genuinely
**still open** (an owner was assigned and didn't execute) from **never assigned** (no sub-phase in
2.1–2.5 ever scoped the work at all) — the two are not the same state and this document previously
did not distinguish them:

- **Default token TTL** — §1 proposes 14 days as a plausible fit for a
  permit-review cycle. This is not derived from any product requirement
  read during this spec's research; it needs a real decision, not this
  document's guess, before 2.1 ships.

  > **Status — Unassigned, deferred.** No sub-phase in the §6 table (2.1–2.5) implements token
  > *issuance* logic — 2.1 is schema only, 2.2–2.5 build the bridge layer's read/write operations
  > against tokens already assumed to exist. This item also missed a deadline this document set for
  > itself ("before 2.1 ships," never met) — that is a different, worse state than "never assigned,"
  > and is recorded as such rather than folded into the same bucket as the items below that were never
  > given a deadline at all. Owner: whichever future sub-phase first implements token issuance.

- **Staff-facing issuance/revocation UI and its own role gate** — §1's
  matrix names "org staff" as the trigger for issuance/revocation but does
  not specify which `org_role` tier(s) can do so. This spec deliberately
  did not guess a tier (e.g. "owner/org_owner only" vs. "any member") —
  that's a product decision for whoever scopes 2.1, not inferable from
  anything read here.

  > **Status — Unassigned, deferred.** Same reasoning as the TTL item above: no sub-phase in 2.1–2.5
  > scopes any UI or route work at all (§6's table is schema/grants/bridge-module operations only).
  > Never given a deadline the way TTL was, so this is "never assigned," not "missed." Owner:
  > whichever future sub-phase first builds a staff-facing route for issuance/revocation.

- **Rate limiting / abuse handling on token validation itself** (e.g.
  repeated invalid-token lookups against `resolveToken`) is not designed
  in this document. §1 covers legitimate lifecycle states; it does not
  cover an adversary hammering the endpoint with guessed tokens. This is a
  real gap this spec is not resolving, not an oversight being hidden.

  > **Status — Unassigned, deferred.** Never assigned to any of 2.1–2.5. Rate limiting is also
  > meaningless with no live target yet: zero routes call `lib/bridge/client-portal.ts` as of this
  > retrofit (see `GATE_2_0_FINDINGS.md` §M.4(a)/§N), so there is no reachable endpoint to rate-limit
  > today. Owner: whichever future sub-phase first exposes `resolveToken` (or `uploadDocument`) behind
  > a live, reachable route.

- **Whether the second Supabase project's own infrastructure (hosting,
  billing, backup/DR posture) has been provisioned at all** was out of
  scope for this document's research and is not addressed.

  > **Status — Not a Claude-owned sub-phase deliverable; explicitly the user's own responsibility.**
  > `GATE_2_0_FINDINGS.md` §L.3 records the user's own statement directly: "When 2.4 needs it, I'll
  > create the project and paste values into my own local `.env` and GitHub secrets myself." No
  > sub-phase owner is assigned here because none should be — provisioning was never this project's
  > work to schedule, and marking it "unassigned" the same way as the items above would misstate whose
  > job it is.

- **A staff-facing read path for `client_access_log`** — §4's guarantees
  comparison identifies that this table has no DB-native, RLS-enforced
  read restriction (project 2 has no staff-authenticated role for such a
  policy to attach to), unlike `audit_logs`. Today the only way to read it
  is holding project 2's raw credentials directly. A proper staff-facing
  bridge-layer read operation, enforcing org-membership in application
  code, is not designed here and is not part of this gate's operation set
  (§3) — it is future work, named so the gap isn't silently assumed closed.

  > **Status — Unassigned, deferred.** This item's own text already states it is deliberately excluded
  > from §3's operation set; §6's table never scopes it to 2.1–2.5 either. Never given a deadline.
  > Owner: none named as of this retrofit — still needs one before it can move from "known gap" to
  > "scheduled work."

---

Not self-issuing `APPROVED: PHASE 2.0`. This spec is for review.
