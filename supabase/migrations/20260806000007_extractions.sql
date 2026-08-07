-- 3.9. Append-only: every extraction attempt is a new row, never an overwrite,
-- so a bad re-extraction can't silently erase the audit trail of what the model
-- actually saw and returned on a prior try.

create table extractions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references permit_applications(id) on delete cascade,
  model_id text not null,
  prompt_version text not null,
  input_token_count int not null check (input_token_count >= 0),
  output_token_count int not null check (output_token_count >= 0),
  raw_response jsonb not null,
  parsed_data jsonb,
  zod_valid boolean not null,
  created_at timestamptz not null default now()
);

create index extractions_application_id_idx on extractions (application_id);

alter table extractions enable row level security;

create policy extractions_select on extractions
  for select to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = extractions.application_id
        and is_org_member(pa.org_id)
    )
  );

-- No UPDATE/DELETE policy is granted to `authenticated` -- RLS denies both by
-- default. The trigger below is a second, storage-engine-level backstop that
-- also blocks the `postgres`/service_role connections used by the Inngest
-- worker, which otherwise bypass RLS entirely.
create or replace function forbid_update_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; % is not permitted on it', TG_TABLE_NAME, TG_OP;
end;
$$;

create trigger extractions_append_only
  before update or delete on extractions
  for each row execute function forbid_update_delete();
