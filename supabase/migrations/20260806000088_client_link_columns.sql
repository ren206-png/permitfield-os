-- Production fix: client links (e-signature, estimate, invoice, change order,
-- credit note) could not be created or opened.
--
-- In production CLIENT_PORTAL_SUPABASE_URL points at this project, and the
-- client-portal tables here were created from an earlier draft of
-- supabase-client-portal/supabase/migrations/20260814000001: they lack
-- client_access_tokens.recipient_email_display and client_access_log.detail.
-- lib/bridge/client-portal.ts inserts and selects both, so every
-- issueTargetToken() failed ("Could not find the 'recipient_email_display'
-- column ... in the schema cache", seen 2026-10-13 when a customer sent a
-- Vancouver form for e-signature) and no link was ever issued (0 rows).
--
-- Guarded on the tables existing: in local dev and CI the portal schema lives
-- in its own stack (supabase-client-portal/), not in this database.

do $$
begin
  if to_regclass('public.client_access_tokens') is not null then
    alter table public.client_access_tokens add column if not exists recipient_email_display text;
    update public.client_access_tokens set recipient_email_display = recipient_email where recipient_email_display is null;
    alter table public.client_access_tokens alter column recipient_email_display set not null;
  end if;

  if to_regclass('public.client_access_log') is not null then
    alter table public.client_access_log add column if not exists detail text;
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.client_access_log'::regclass and conname = 'client_access_log_detail_only_when_denied'
    ) then
      alter table public.client_access_log
        add constraint client_access_log_detail_only_when_denied check ((outcome = 'denied') or (detail is null));
    end if;
  end if;
end $$;

-- PostgREST caches the schema; make the new columns visible immediately.
notify pgrst, 'reload schema';
