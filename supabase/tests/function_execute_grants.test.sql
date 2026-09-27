-- Regression guard for 20260806000071_revoke_anon_execute_on_definer_functions.sql.
-- Proves:
--   1. No public SECURITY DEFINER function is executable by anon, other than
--      read-only predicates about the caller (which return false for anon).
--   2. service_role-only functions are not executable by authenticated.
--   3. Revoking PUBLIC did not cut off authenticated/service_role from the
--      functions meant for them.

begin;

do $$
declare
  v_leaks text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname)
  into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> all (array[
      'is_org_member', 'is_org_owner', 'is_platform_admin', 'is_org_billing_manager',
      'can_read_audit_logs', 'can_read_ai_ledger', 'can_manage_api_keys', 'can_submit_filings'
    ]);
  if v_leaks is not null then
    raise exception 'FAIL: anon can execute SECURITY DEFINER function(s): %', v_leaks;
  end if;
  raise notice 'PASS: anon can execute no SECURITY DEFINER function beyond the caller-predicate allowlist.';
end $$;

do $$
declare
  v_leaks text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array[
      'record_change_order_acceptance', 'record_estimate_acceptance', 'record_online_payment',
      'reverse_online_payment_from_webhook', 'update_org_stripe_connect_account_status', 'record_permit_signature'
    ])
    and has_function_privilege('authenticated', p.oid, 'execute');
  if v_leaks is not null then
    raise exception 'FAIL: authenticated can execute service_role-only function(s): %', v_leaks;
  end if;
  raise notice 'PASS: service_role-only functions are not executable by authenticated.';
end $$;

-- Revoking PUBLIC must not have cut off the roles these functions are for.
do $$
declare
  v_missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_missing
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array[
      'archive_application_document', 'create_organization_with_owner', 'create_project_with_intake',
      'evaluate_project_permit_requirements', 'issue_change_order', 'issue_credit_note', 'issue_invoice',
      'override_readiness_check', 'record_payment', 'replace_application_document', 'reverse_payment',
      'review_project_permit_requirement', 'send_change_order_for_acceptance', 'send_estimate',
      'transition_permit_status', 'upsert_org_stripe_connect_account', 'verify_jurisdiction_source',
      'void_change_order', 'void_credit_note', 'void_invoice',
      'request_permit_signature', 'cancel_permit_signature_request'
    ])
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_missing is not null then
    raise exception 'FAIL: authenticated lost EXECUTE on: %', v_missing;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
  into v_missing
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array[
      'record_change_order_acceptance', 'record_estimate_acceptance', 'record_online_payment',
      'reverse_online_payment_from_webhook', 'update_org_stripe_connect_account_status', 'record_permit_signature'
    ])
    and not has_function_privilege('service_role', p.oid, 'execute');
  if v_missing is not null then
    raise exception 'FAIL: service_role lost EXECUTE on: %', v_missing;
  end if;
  raise notice 'PASS: authenticated and service_role keep EXECUTE on the functions meant for them.';
end $$;

rollback;
