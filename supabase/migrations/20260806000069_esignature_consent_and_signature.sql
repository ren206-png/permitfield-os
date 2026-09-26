-- E-signature, Stage A: explicit consent to sign electronically plus a
-- captured signature (typed or drawn) on estimate and change-order
-- acceptances. Additive only.
--
-- Both acceptance tables already record the signer's typed name, claimed
-- authority, IP, user agent, timestamp and a fingerprint of the exact
-- document accepted (revision_hash / snapshot_hash). What they lacked for an
-- ESIGN/UETA-style electronic signature record was (1) affirmative consent to
-- transact electronically, stored with the exact wording agreed to, and
-- (2) the signature mark itself. Rows accepted before this migration keep all
-- four new columns null; every acceptance recorded from now on must carry
-- consent and a signature -- enforced by the shape CHECKs below and by the
-- two acceptance functions, which are the only write path to these tables.
--
-- signature_png_base64 holds a drawn signature as raw base64 PNG (no
-- data: URL prefix), capped at 400k characters (~300 KB decoded); a typed
-- signature stores no image -- typed_name is the mark.

alter table estimate_acceptances
  add column esign_consent_text text,
  add column esign_consent_at timestamptz,
  add column signature_method text check (signature_method in ('typed', 'drawn')),
  add column signature_png_base64 text check (
    signature_png_base64 is null or char_length(signature_png_base64) <= 400000
  ),
  add constraint estimate_acceptances_esign_shape_check check (
    (esign_consent_text is null and esign_consent_at is null
      and signature_method is null and signature_png_base64 is null)
    or (esign_consent_text is not null and esign_consent_at is not null
      and signature_method is not null
      and (signature_method = 'drawn') = (signature_png_base64 is not null))
  );

alter table change_order_acceptances
  add column esign_consent_text text,
  add column esign_consent_at timestamptz,
  add column signature_method text check (signature_method in ('typed', 'drawn')),
  add column signature_png_base64 text check (
    signature_png_base64 is null or char_length(signature_png_base64) <= 400000
  ),
  add constraint change_order_acceptances_esign_shape_check check (
    (esign_consent_text is null and esign_consent_at is null
      and signature_method is null and signature_png_base64 is null)
    or (esign_consent_text is not null and esign_consent_at is not null
      and signature_method is not null
      and (signature_method = 'drawn') = (signature_png_base64 is not null))
  );

-- Shared validation for both acceptance functions. Raises before any insert.
-- 'iVBORw0KGgo' is the base64 encoding of the 8-byte PNG file signature.
create or replace function assert_valid_esignature(
  p_esign_consent_text text,
  p_signature_method text,
  p_signature_png_base64 text
)
returns void
language plpgsql
immutable
as $$
begin
  if p_esign_consent_text is null or btrim(p_esign_consent_text) = '' then
    raise exception 'esign_consent_required: consent to sign electronically is required';
  end if;
  if p_signature_method is null or p_signature_method not in ('typed', 'drawn') then
    raise exception 'invalid_signature_method: %', coalesce(p_signature_method, 'null');
  end if;
  if p_signature_method = 'drawn' then
    if p_signature_png_base64 is null
      or char_length(p_signature_png_base64) > 400000
      or left(p_signature_png_base64, 11) <> 'iVBORw0KGgo' then
      raise exception 'invalid_signature_image: a drawn signature must be a base64 PNG under 400000 characters';
    end if;
  elsif p_signature_png_base64 is not null then
    raise exception 'invalid_signature_image: a typed signature must not include an image';
  end if;
end;
$$;

revoke all on function assert_valid_esignature(text, text, text) from public;
grant execute on function assert_valid_esignature(text, text, text) to service_role;

-- The acceptance functions gain three trailing parameters (defaulted, so the
-- first seven positional arguments are unchanged). Validation order is
-- deliberate: the existing not-found / stale / missing-name checks still run
-- first and raise exactly as before; the e-signature check runs last, just
-- before the insert. A new signature means a new function, so the old
-- 7-argument versions are dropped rather than left as a consent-free
-- overload.
drop function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text);

create function record_estimate_acceptance(
  p_revision_id uuid,
  p_revision_hash text,
  p_accepted_scope_snapshot jsonb,
  p_typed_name text,
  p_claimed_authority text,
  p_ip inet default null,
  p_user_agent text default null,
  p_esign_consent_text text default null,
  p_signature_method text default null,
  p_signature_png_base64 text default null
)
returns estimate_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev estimate_revisions;
  v_est estimates;
  v_acceptance estimate_acceptances;
begin
  select * into v_rev from estimate_revisions where id = p_revision_id;
  if v_rev.id is null then
    raise exception 'estimate_revision % not found', p_revision_id;
  end if;

  select * into v_est from estimates where id = v_rev.estimate_id for update;
  if v_est.id is null then
    raise exception 'estimate % not found for revision %', v_rev.estimate_id, p_revision_id;
  end if;

  if v_est.current_revision_id is distinct from p_revision_id then
    raise exception 'stale_revision: revision % is no longer the current revision for estimate % (current is %)',
      p_revision_id, v_est.id, v_est.current_revision_id
      using errcode = '22023';
  end if;

  if p_typed_name is null or btrim(p_typed_name) = '' then
    raise exception 'typed_name is required';
  end if;
  if p_claimed_authority is null or btrim(p_claimed_authority) = '' then
    raise exception 'claimed_authority is required';
  end if;

  perform assert_valid_esignature(p_esign_consent_text, p_signature_method, p_signature_png_base64);

  insert into estimate_acceptances (
    org_id, estimate_id, revision_id, revision_hash, accepted_scope_snapshot,
    typed_name, claimed_authority, ip, user_agent,
    esign_consent_text, esign_consent_at, signature_method, signature_png_base64
  ) values (
    v_est.org_id, v_est.id, p_revision_id, p_revision_hash, p_accepted_scope_snapshot,
    p_typed_name, p_claimed_authority, p_ip, p_user_agent,
    p_esign_consent_text, now(), p_signature_method, p_signature_png_base64
  )
  returning * into v_acceptance;

  update estimates set status = 'accepted', updated_at = now() where id = v_est.id;

  return v_acceptance;
end;
$$;

revoke all on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) from public;
revoke all on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) from authenticated;
grant execute on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) to service_role;

drop function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text);

create function record_change_order_acceptance(
  p_change_order_id uuid,
  p_snapshot_hash text,
  p_accepted_snapshot jsonb,
  p_typed_name text,
  p_claimed_authority text,
  p_ip inet default null,
  p_user_agent text default null,
  p_esign_consent_text text default null,
  p_signature_method text default null,
  p_signature_png_base64 text default null
)
returns change_order_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
  v_acceptance change_order_acceptances;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'change_order % not found', p_change_order_id;
  end if;

  if v_co.status <> 'pending_acceptance' then
    raise exception 'stale_change_order: change_order % is not awaiting acceptance (current status: %)',
      p_change_order_id, v_co.status
      using errcode = '22023';
  end if;

  if p_typed_name is null or btrim(p_typed_name) = '' then
    raise exception 'typed_name is required';
  end if;
  if p_claimed_authority is null or btrim(p_claimed_authority) = '' then
    raise exception 'claimed_authority is required';
  end if;

  perform assert_valid_esignature(p_esign_consent_text, p_signature_method, p_signature_png_base64);

  insert into change_order_acceptances (
    org_id, change_order_id, snapshot_hash, accepted_snapshot,
    typed_name, claimed_authority, ip, user_agent,
    esign_consent_text, esign_consent_at, signature_method, signature_png_base64
  ) values (
    v_co.org_id, v_co.id, p_snapshot_hash, p_accepted_snapshot,
    p_typed_name, p_claimed_authority, p_ip, p_user_agent,
    p_esign_consent_text, now(), p_signature_method, p_signature_png_base64
  )
  returning * into v_acceptance;

  update change_orders set status = 'accepted', updated_at = now() where id = v_co.id;

  return v_acceptance;
end;
$$;

revoke all on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) from public;
revoke all on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) from authenticated;
grant execute on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text, text, text, text) to service_role;
