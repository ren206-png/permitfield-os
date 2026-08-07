-- Two private Storage buckets: uploads (contractor-submitted source
-- documents) and generated (Phase 4's filled PDFs). Both are private --
-- public=false -- access is gated entirely through the RLS policies below,
-- never a public URL.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('permitfield-uploads', 'permitfield-uploads', false, 26214400),
  ('permitfield-generated', 'permitfield-generated', false, 26214400)
on conflict (id) do nothing;

-- Path convention (lib/storage/documents.ts, buildStoragePath):
-- `${orgId}/${applicationId}/${sha256}-${filename}`. The leading orgId
-- segment is what these policies authorize against, via
-- storage.foldername(name)[1] -- mirroring the org_id scoping every other
-- tenant table in this schema uses (is_org_member, from
-- 20260806000002_organizations_and_members.sql). This is why that segment
-- is load-bearing, not cosmetic: a path that omitted or reordered it would
-- silently defeat these policies.
create policy uploads_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'permitfield-uploads'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy uploads_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'permitfield-uploads'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy uploads_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'permitfield-uploads'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

-- Generated documents (Phase 4: filled permit PDFs) are written by the
-- service-role worker (which bypasses RLS entirely, per
-- lib/supabase/service-client.ts) and only ever read by end users after the
-- human-review gate -- so authenticated users get select only, never
-- insert/update/delete.
create policy generated_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'permitfield-generated'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
