-- Account deletion: a person can delete their own account from the app
-- (Settings -> Security). Required for the iPhone app (App Store Review
-- Guideline 5.1.1(v)) and expected under Canadian privacy law.
--
-- What deleting an account does (delete_account(), called only by the
-- server action app/(app)/settings/security/actions.ts with the service role):
--   - Companies where the person is the only member are deleted with all
--     their data (applications, documents, invoices...). Their uploaded
--     files are removed from Storage by the server action afterwards.
--   - Companies they share with others keep their records; the person's
--     membership is removed. If they're that company's only owner, deletion
--     is refused until they hand ownership to someone else.
--   - The login itself is deleted. When shared-company records still point
--     at it (who created an estimate, who uploaded a document...), it is
--     de-identified instead: email, phone, name, password, linked Google /
--     Microsoft / Apple identities, sessions and two-factor factors are all
--     removed and the account is permanently locked.
--
-- Deleting a company has to remove rows from append-only tables (audit_logs,
-- generated_documents, ...), whose triggers refuse every DELETE. They get one
-- narrow exception: account_deletion_in_progress() is true only inside a
-- function running as postgres (SECURITY DEFINER) that has set the
-- transaction-local flag. API sessions run as anon / authenticated /
-- service_role and can never satisfy the first half.

create or replace function public.account_deletion_in_progress()
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select current_user = 'postgres'
    and coalesce(current_setting('permitfield.account_deletion', true), '') = 'on'
$$;

create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $function$
begin
  if public.account_deletion_in_progress() then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  raise exception '% is append-only; % is not permitted on it', TG_TABLE_NAME, TG_OP;
end;
$function$;

create or replace function public.forbid_delete()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $function$
begin
  if public.account_deletion_in_progress() then
    return OLD;
  end if;
  raise exception '% rows may never be deleted', TG_TABLE_NAME;
end;
$function$;

create or replace function public.delete_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_org_id uuid;
  v_deleted_orgs uuid[] := '{}';
  v_left_orgs uuid[] := '{}';
  v_deidentified boolean := false;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'not_found: no such account';
  end if;

  if exists (
    select 1
    from org_members mine
    where mine.user_id = p_user_id
      and mine.role in ('owner', 'org_owner')
      and exists (select 1 from org_members other where other.org_id = mine.org_id and other.user_id <> p_user_id)
      and not exists (
        select 1 from org_members other where other.org_id = mine.org_id and other.user_id <> p_user_id and other.role in ('owner', 'org_owner')
      )
  ) then
    raise exception 'sole_owner: make someone else an owner of your shared company first (Settings, Team), or remove its other members';
  end if;

  perform set_config('permitfield.account_deletion', 'on', true);

  for v_org_id in select org_id from org_members where user_id = p_user_id loop
    if exists (select 1 from org_members where org_id = v_org_id and user_id <> p_user_id) then
      delete from org_members where org_id = v_org_id and user_id = p_user_id;
      v_left_orgs := v_left_orgs || v_org_id;
    else
      -- Client links live in tables with no foreign key to organizations
      -- (in production they share this database; locally they don't exist).
      if to_regclass('public.client_access_tokens') is not null then
        if to_regclass('public.client_access_log') is not null then
          execute 'delete from public.client_access_log where token_id in (select id from public.client_access_tokens where org_id = $1)' using v_org_id;
        end if;
        if to_regclass('public.token_lifecycle_events') is not null then
          execute 'delete from public.token_lifecycle_events where token_id in (select id from public.client_access_tokens where org_id = $1)' using v_org_id;
        end if;
        execute 'delete from public.client_access_tokens where org_id = $1' using v_org_id;
      end if;
      delete from organizations where id = v_org_id;
      v_deleted_orgs := v_deleted_orgs || v_org_id;
    end if;
  end loop;

  begin
    delete from auth.users where id = p_user_id;
  exception
    when foreign_key_violation then
      -- Shared-company records still name this login: keep the row, strip it.
      delete from auth.identities where user_id = p_user_id;
      delete from auth.sessions where user_id = p_user_id;
      delete from auth.mfa_factors where user_id = p_user_id;
      delete from auth.one_time_tokens where user_id = p_user_id;
      update auth.users
      set email = 'deleted-' || p_user_id || '@deleted.permitfieldos.invalid',
          phone = null,
          encrypted_password = '',
          raw_user_meta_data = '{}'::jsonb,
          raw_app_meta_data = '{"provider":"deleted","providers":[]}'::jsonb,
          email_change = '',
          phone_change = '',
          confirmation_token = '',
          recovery_token = '',
          email_change_token_new = '',
          email_change_token_current = '',
          banned_until = 'infinity',
          updated_at = now()
      where id = p_user_id;
      v_deidentified := true;
  end;

  return jsonb_build_object('deleted_orgs', to_jsonb(v_deleted_orgs), 'left_orgs', to_jsonb(v_left_orgs), 'deidentified', v_deidentified);
end;
$function$;

revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
-- account_deletion_in_progress() keeps the default EXECUTE for everyone: the
-- append-only triggers call it as whoever is writing (including
-- supabase_auth_admin when Auth deletes a user), and it only reports a fact.
