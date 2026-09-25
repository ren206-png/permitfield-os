-- Public API, v1 (read-only, flag PERMITFIELD_FF_PUBLIC_API). Additive only.
--
-- org_api_keys: org-scoped bearer credentials for app/api/v1/*. The secret
-- itself is never stored -- only its SHA-256 hex digest (key_hash), same
-- "store the hash, never the bearer credential" rule client_access_tokens
-- already follows (lib/bridge/client-portal.ts). key_prefix is the first
-- few characters of the plaintext key, kept only so the settings page can
-- show which key is which.
--
-- api_request_log: one append-only row per non-rate-limited v1 request. It is both the
-- audit trail org owners can read and the source of truth for rate
-- limiting (lib/public-api/handler.ts counts recent rows per key and per
-- ip), since serverless instances share no memory.
--
-- Key management is restricted to owner/org_owner/platform_admin rather
-- than every org member (is_org_member) or is_org_billing_manager's set: a
-- key can read the whole org's project and application data, so it is a
-- higher-trust credential than anything permit_manager otherwise gets.
-- plpgsql, not sql: this body references org_role values added by
-- 20260806000018's ALTER TYPE; same reason can_read_audit_logs() is plpgsql.
create or replace function can_manage_api_keys(check_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'platform_admin')
  );
end;
$$;

revoke all on function can_manage_api_keys(uuid) from public;
grant execute on function can_manage_api_keys(uuid) to authenticated;

create table org_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  key_prefix text not null check (char_length(key_prefix) between 8 and 16),
  key_hash char(64) not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index org_api_keys_org_id_created_at_idx on org_api_keys (org_id, created_at desc);

alter table org_api_keys enable row level security;

create policy org_api_keys_select on org_api_keys
  for select to authenticated
  using (can_manage_api_keys(org_id));

create policy org_api_keys_insert on org_api_keys
  for insert to authenticated
  with check (can_manage_api_keys(org_id) and created_by = auth.uid());

-- Revoke-only: USING admits only still-active rows and WITH CHECK requires
-- the result to be revoked, so a revoked key can never be un-revoked. The
-- column-level UPDATE grant below means revoked_at is the only column this
-- policy can ever be exercised against.
create policy org_api_keys_revoke on org_api_keys
  for update to authenticated
  using (can_manage_api_keys(org_id) and revoked_at is null)
  with check (can_manage_api_keys(org_id) and revoked_at is not null);

-- Supabase grants every role the full privilege set on public tables by
-- platform default (SERVICE_ROLE_GRANTS_FINDINGS.md), so omitting a grant
-- does not deny it -- revoke first, then grant back exactly what is used.
-- authenticated never gets key_hash back (column-level SELECT) and can only
-- ever write revoked_at on an existing row. INSERT/RETURNING callers must
-- name columns explicitly rather than select('*').
revoke all on org_api_keys from anon, authenticated;
grant select (id, org_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at)
  on org_api_keys to authenticated;
grant insert (org_id, name, key_prefix, key_hash, created_by) on org_api_keys to authenticated;
grant update (revoked_at) on org_api_keys to authenticated;

-- service_role resolves a presented key by hash and stamps last_used_at;
-- it never creates, deletes, or rewrites keys.
revoke insert, delete, truncate on org_api_keys from service_role;
revoke update on org_api_keys from service_role;
grant select on org_api_keys to service_role;
grant update (last_used_at) on org_api_keys to service_role;

create table api_request_log (
  id uuid primary key default gen_random_uuid(),
  -- Both null for a request whose credential never resolved to a key.
  org_id uuid references organizations(id) on delete cascade,
  api_key_id uuid references org_api_keys(id) on delete cascade,
  -- text, not inet: this is the first hop of a client-supplied
  -- x-forwarded-for header, and a malformed value must not make the log
  -- insert (and therefore the request's audit trail) fail.
  ip text,
  method text not null,
  path text not null,
  status_code smallint not null,
  -- Rate-limited (429) responses are deliberately not logged: logging them
  -- would turn a request flood into an unbounded insert flood, and leaving
  -- them out keeps the per-key/per-ip windows sliding correctly.
  outcome text not null check (outcome in ('ok', 'denied', 'forbidden', 'error')),
  created_at timestamptz not null default now(),
  check ((org_id is null) = (api_key_id is null))
);

create index api_request_log_key_created_at_idx on api_request_log (api_key_id, created_at desc)
  where api_key_id is not null;
create index api_request_log_ip_denied_idx on api_request_log (ip, created_at desc)
  where outcome = 'denied' and api_key_id is null;
create index api_request_log_org_created_at_idx on api_request_log (org_id, created_at desc)
  where org_id is not null;

alter table api_request_log enable row level security;

create policy api_request_log_select on api_request_log
  for select to authenticated
  using (org_id is not null and can_manage_api_keys(org_id));

create trigger api_request_log_append_only
  before update or delete on api_request_log
  for each row execute function forbid_update_delete();

revoke all on api_request_log from anon, authenticated;
grant select on api_request_log to authenticated;

-- TRUNCATE bypasses the row-level trigger above (TRUNCATE_HARDENING_FINDINGS.md).
revoke update, delete, truncate on api_request_log from service_role;
grant select, insert on api_request_log to service_role;
