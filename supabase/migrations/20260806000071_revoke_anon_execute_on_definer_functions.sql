-- Security fix: close anonymous (anon-key) access to SECURITY DEFINER
-- functions.
--
-- Supabase's default privileges grant EXECUTE on every new public-schema
-- function to anon and authenticated *directly*. Earlier migrations revoked
-- EXECUTE from PUBLIC (and sometimes authenticated) and assumed that closed
-- the function -- it does not remove the direct anon grant. An audit of
-- production on 2026-09-26 found 34 SECURITY DEFINER functions callable by
-- anon through PostgREST (/rest/v1/rpc/...) with the public anon key. None
-- was ever meant for anon. Several run with no internal caller check at all
-- because they were designed to be reachable only by service_role
-- (e.g. record_online_payment, reverse_online_payment_from_webhook,
-- record_estimate_acceptance). Production held no estimates, invoices or
-- payments at the time.
--
-- 1. Revoke anon EXECUTE (and PUBLIC's, which anon inherits) from every
--    data-changing / service-only definer function below (all overloads,
--    by name). authenticated/service_role keep their explicit grants. The seven read-only
--    permission predicates about the *caller* (is_org_member, is_org_owner,
--    is_platform_admin, is_org_billing_manager, can_read_audit_logs,
--    can_read_ai_ledger, can_manage_api_keys, and can_submit_filings where
--    present) are left alone: for anon they simply return false, and RLS
--    policies that apply to all roles may call them.
-- 2. Revoke authenticated EXECUTE from the functions intended for
--    service_role only.
--
-- Default privileges are deliberately not changed here: new functions get
-- EXECUTE through PUBLIC locally but through direct anon/authenticated
-- grants on hosted Supabase, and removing PUBLIC would mean altering a
-- global default. Instead supabase/tests/function_execute_grants.test.sql
-- fails CI whenever any SECURITY DEFINER function is anon-executable, so a
-- future migration that forgets to revoke anon cannot merge.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'archive_application_document',
        'create_organization_with_owner',
        'create_project_with_intake',
        'evaluate_project_permit_requirements',
        'issue_change_order',
        'issue_credit_note',
        'issue_invoice',
        'override_readiness_check',
        'record_change_order_acceptance',
        'record_estimate_acceptance',
        'record_online_payment',
        'record_payment',
        'replace_application_document',
        'reverse_online_payment_from_webhook',
        'reverse_payment',
        'review_project_permit_requirement',
        'seed_document_revision',
        'seed_permit_status_history',
        'send_change_order_for_acceptance',
        'send_estimate',
        'transition_permit_status',
        'update_org_stripe_connect_account_status',
        'upsert_org_stripe_connect_account',
        'verify_jurisdiction_source',
        'void_change_order',
        'void_credit_note',
        'void_invoice'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'record_change_order_acceptance',
        'record_estimate_acceptance',
        'record_online_payment',
        'reverse_online_payment_from_webhook',
        'update_org_stripe_connect_account_status'
      ])
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;
