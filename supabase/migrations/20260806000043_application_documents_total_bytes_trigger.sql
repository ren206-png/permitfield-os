-- Health-check audit finding: app/api/documents/route.ts enforces the
-- 100 MB-per-application total (MAX_APPLICATION_TOTAL_BYTES,
-- lib/storage/documents.ts) purely in application code via a
-- check-then-act pattern: SELECT sum(byte_size) for the application, then
-- (if under the cap) upload to Storage and INSERT. Two concurrent upload
-- requests for the same application (e.g. two browser tabs, or a retried
-- request racing the original) can each read a sum that's still under the
-- cap and both proceed, jointly exceeding it -- the per-file CHECK
-- constraint (application_documents.byte_size, migration 20260806000006)
-- catches an oversized single file but has no way to see the running total
-- across rows. This migration moves the total-bytes enforcement into the
-- database, where it's atomic with respect to concurrent transactions,
-- closing the race. The application-layer check in route.ts is left in
-- place deliberately (not removed) -- it's still valuable as a fast,
-- pre-upload rejection that avoids doing Storage work for a request that's
-- going to fail anyway; this trigger is the actual source of truth.
--
-- 104857600 = 100 * 1024 * 1024, matching MAX_APPLICATION_TOTAL_BYTES in
-- lib/storage/documents.ts exactly. If that constant ever changes, this
-- migration's replacement must change with it -- there is no shared source
-- of truth between SQL and TypeScript for this number today.
create or replace function enforce_application_documents_total_bytes()
returns trigger
language plpgsql
as $$
declare
  existing_total bigint;
begin
  -- Serialize concurrent inserts for the same application_id so the sum
  -- check below can't race with another in-flight insert for that same
  -- application -- ordinary read-committed visibility would let two
  -- concurrent transactions each read a sum that's still under the cap and
  -- both commit, jointly exceeding it. hashtextextended(..., 0) folds the
  -- uuid down to a bigint lock key; the lock is released automatically at
  -- transaction end (pg_advisory_xact_lock), so no explicit unlock is
  -- needed and a crashed/aborted transaction can't leak it.
  perform pg_advisory_xact_lock(hashtextextended(new.application_id::text, 0));

  select coalesce(sum(byte_size), 0)
    into existing_total
    from application_documents
   where application_id = new.application_id;

  if existing_total + new.byte_size > 104857600 then
    raise exception
      'application % total document bytes would exceed the 100 MB limit (existing % + new % bytes)',
      new.application_id, existing_total, new.byte_size
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger application_documents_total_bytes_check
  before insert on application_documents
  for each row
  execute function enforce_application_documents_total_bytes();
