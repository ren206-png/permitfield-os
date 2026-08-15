-- Rollback for 20260806000013_storage_buckets.sql
-- Policies before the bucket rows. Deleting the bucket rows will fail with
-- an FK error (not silently) if any storage.objects row still references
-- either bucket -- expected to be empty in the --no-seed rollback-test loop
-- this directory is verified against, but a populated environment would
-- need those objects removed first, same caveat storage.buckets' own FK
-- enforces regardless of this file.
--
-- storage.buckets/storage.objects carry a Supabase-platform
-- protect_buckets_delete/protect_objects_delete trigger (storage.protect_delete())
-- that raises unless the session-local GUC storage.allow_delete_query is
-- 'true' -- confirmed empirically by this rollback's own test run, not
-- visible from reading this repo's migrations (none of them ever DELETE from
-- a storage table). `set local` scopes the override to this single
-- transaction; wrapping the delete in an explicit transaction block means
-- the override never leaks into any statement outside this file.

drop policy if exists generated_select on storage.objects;
drop policy if exists uploads_delete on storage.objects;
drop policy if exists uploads_insert on storage.objects;
drop policy if exists uploads_select on storage.objects;

begin;
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id in ('permitfield-uploads', 'permitfield-generated');
commit;
