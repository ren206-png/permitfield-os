-- Gate 4 (Quotes & Payments), Phase A -- client-portal token extension.
-- GATE_4_FINDINGS.md §4/§I item 3 (resolved): a quote/invoice link
-- extends this project's existing `client_access_tokens` system rather
-- than building a second, parallel token table. §4's own forward-path
-- self-check flags the concrete blocker this migration exists to remove:
-- `client_access_tokens.application_id uuid not null` hard-codes "every
-- token points at a permit application," but a quote/invoice link needs
-- to point at an `estimates`/`invoices` row in the OTHER (main) project
-- instead -- there is no shared FK space between the two projects (same
-- design constraint `client_access_tokens.application_id`/`org_id`
-- already document as bare, non-FK columns), so this widens the same
-- bare-pointer pattern to a second target shape rather than inventing a
-- different mechanism.
--
-- Purely additive, by explicit instruction:
--   - `application_id` is NOT removed, renamed, or made nullable. It keeps
--     its exact `uuid not null` shape from 20260814000001. Every existing
--     caller (bridge-layer code, the test suite) that only ever sets
--     `application_id` keeps working unmodified.
--   - Two new columns, both nullable, added alongside it: `target_kind`
--     (a discriminator, same "bare text tag, not an enum" choice as
--     `client_access_log.operation` -- a fixed enum would need a schema
--     migration every time a new linkable target type is added, e.g. a
--     future `change_order` link in Phase B) and `target_id` (the bare,
--     non-FK cross-project pointer itself, matching `application_id`'s own
--     precedent exactly).
--   - Existing rows are backfilled below so every row -- old or new -- ends
--     up with a consistent `target_kind`/`target_id` pair, but the
--     BEFORE INSERT trigger further down means no future caller is ever
--     REQUIRED to set these two columns explicitly: a caller that only
--     provides `application_id` (every existing test-suite insert, and
--     every existing bridge-layer call site) gets `target_kind =
--     'permit_application'`/`target_id = application_id` populated
--     automatically, so 20260814000001's full existing test file
--     (`client_portal_token_lifecycle.test.sql`) keeps passing completely
--     unmodified -- it was read in full before writing this migration
--     specifically to confirm none of its inserts reference these two new
--     columns.
--   - A future quote/invoice-link issuance path (not built in this pass --
--     the future bridge-layer module GATE_4_FINDINGS.md §4/§7 describes)
--     sets `target_kind = 'estimate'` or `'invoice'` and `target_id =
--     <that row's id in the main project>` explicitly, bypassing the
--     trigger's auto-populate branch (it only fires when both are still
--     null), while continuing to also set `application_id` to whatever
--     permit application the estimate/invoice's project is associated
--     with, if any -- `application_id` remains "what permit application
--     does this token's underlying work relate to" (permit-optional, per
--     GATE_4_FINDINGS.md's own "permit is optional" rule elsewhere in this
--     gate, so a quote with no permit application could in principle need
--     `application_id` to become nullable too -- flagged as a genuine open
--     question in this pass's final report, NOT resolved here, since
--     changing that column's NOT NULL is explicitly out of this migration's
--     purely-additive scope).
alter table client_access_tokens add column target_kind text;
alter table client_access_tokens add column target_id uuid;

-- Backfill: every row that existed before this migration was, by
-- definition, a permit-application link (the only kind that existed) --
-- populate both new columns from the column that already encodes exactly
-- that fact, `application_id`.
update client_access_tokens
set target_kind = 'permit_application', target_id = application_id
where target_kind is null;

-- Both-set-together CHECK: `target_kind`/`target_id` are optional as a
-- PAIR (a legacy row created before either column existed in some other
-- environment could in principle have neither, though the backfill above
-- means no row in THIS database ever will after this migration runs), but
-- one can never be set without the other -- half a pointer is not a
-- meaningful value. `target_kind` is deliberately not constrained to a
-- fixed value list here (see header comment on the enum-vs-bare-text
-- choice) -- validating the specific set of legal kinds is left to the
-- future bridge-layer code that actually issues each kind of link, the
-- same way this table's other cross-project bare pointers (`application_id`,
-- `org_id`) carry no format validation beyond "is a uuid" either.
alter table client_access_tokens
  add constraint client_access_tokens_target_kind_id_check
  check ((target_kind is null) = (target_id is null));

-- Auto-populate trigger: lets every existing and future caller that only
-- ever sets `application_id` (the entire current test suite and bridge
-- layer) continue to omit `target_kind`/`target_id` entirely and still end
-- up with a fully-populated, consistent row -- this is what makes the
-- "purely additive, existing tests pass unmodified" requirement actually
-- hold, not just the nullability of the two new columns by itself. Fires
-- only when the caller left BOTH new columns null (an explicit
-- quote/invoice-link caller that sets them itself is never overridden).
create or replace function client_access_tokens_default_target()
returns trigger
language plpgsql
as $$
begin
  if new.target_kind is null and new.target_id is null then
    new.target_kind := 'permit_application';
    new.target_id := new.application_id;
  end if;
  return new;
end;
$$;

create trigger client_access_tokens_default_target_trigger
  before insert on client_access_tokens
  for each row execute function client_access_tokens_default_target();

create index client_access_tokens_target_idx on client_access_tokens (target_kind, target_id);
