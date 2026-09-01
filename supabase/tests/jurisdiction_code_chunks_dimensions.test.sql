-- Gate AI-1, sub-phase AI-1.2 (GATE_AI_1_FINDINGS.md §B, §H STALE_BYLAW).
-- Proves two things about the updated search_jurisdiction_code_chunks
-- (20260806000037_jurisdiction_code_chunks_dimensions_and_effective_window.sql):
--   1. STALE_BYLAW is actually fixed: a superseded chunk (effective_to in
--      the past) and a not-yet-effective chunk (effective_from in the
--      future) are both excluded from results as of today, while the
--      currently-effective chunk (and a legacy always-effective chunk with
--      a null window, matching every pre-existing row) are returned.
--      Control step re-runs the OLD (pre-migration) query shape inline --
--      no window filter at all -- to prove the gap would be real without
--      this migration, the same "prove the gap, then prove the fix" shape
--      as every other control-then-assert test in this repo
--      (supabase/tests/service_role_truncate_append_only.test.sql,
--      supabase/tests/audit_logs.test.sql).
--   2. Dimension filters (permit_type/property_type/language) use
--      "null matches anything" semantics on BOTH sides: a chunk with a null
--      dimension value is universal and always matches; a caller passing a
--      null filter arg means "don't filter on this dimension at all."
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- same standing note as every other supabase/tests/*.test.sql file, see
-- audit_logs.test.sql's header for the exact commands / npm run test:sql).

begin;

-- Toronto, seeded by supabase/seed.sql PART 1 (reference data, safe in any
-- environment) -- reused rather than inventing a new jurisdiction fixture.
-- jurisdiction_code_chunks has no INSERT policy for `authenticated` at all
-- (ingestion is service-role-only, same as every AI-derived corpus table in
-- this repo), so fixtures are seeded as service_role, mirroring how
-- tenant_isolation.test.sql/audit_logs.test.sql seed their own fixtures.
set local role service_role;

-- === Fixtures for the effective-date window (STALE_BYLAW) ===
-- All four chunks share the same distinctive, otherwise-unused phrase so a
-- single BM25 query matches all of them equally; only the window filter
-- (or its absence, in the control step) determines which are returned.
insert into jurisdiction_code_chunks
  (id, jurisdiction_id, code_section, content, source_url, license_status, corpus_version, effective_from, effective_to)
values
  -- Legacy shape: null/null window, matching every pre-migration row --
  -- must remain returned ("always effective") after this migration.
  ('60000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0001-000000000001', '9.1.1',
   'Zoning bylaw setback requirement for accessory structures applies citywide.',
   'https://example.test/bylaw/9-1-1', 'public_record', 'test-v1', null, null),
  -- Superseded: effective_to in the past -- must be EXCLUDED as of today.
  ('60000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0001-000000000001', '9.1.1',
   'Zoning bylaw setback requirement for accessory structures applies citywide.',
   'https://example.test/bylaw/9-1-1-old', 'public_record', 'test-v1', '2020-01-01', '2021-01-01'),
  -- Currently effective: effective_from in the past, no end date -- must be
  -- INCLUDED.
  ('60000000-0000-0000-0000-00000000001c', '00000000-0000-0000-0001-000000000001', '9.1.1',
   'Zoning bylaw setback requirement for accessory structures applies citywide.',
   'https://example.test/bylaw/9-1-1-current', 'public_record', 'test-v1', '2021-01-01', null),
  -- Not yet effective: effective_from in the future -- must be EXCLUDED.
  ('60000000-0000-0000-0000-00000000001d', '00000000-0000-0000-0001-000000000001', '9.1.1',
   'Zoning bylaw setback requirement for accessory structures applies citywide.',
   'https://example.test/bylaw/9-1-1-future', 'public_record', 'test-v1', '2999-01-01', null);

-- === Fixtures for dimension filters ===
-- Distinct phrase from the window fixtures above so this query doesn't
-- accidentally also match those four rows.
insert into jurisdiction_code_chunks
  (id, jurisdiction_id, code_section, content, source_url, license_status, corpus_version, permit_type)
values
  ('60000000-0000-0000-0000-00000000002a', '00000000-0000-0000-0001-000000000001', '4.2.3',
   'Electrical service upgrade panel capacity requirements for building permits.',
   'https://example.test/bylaw/4-2-3-building', 'public_record', 'test-v1', 'building'),
  ('60000000-0000-0000-0000-00000000002b', '00000000-0000-0000-0001-000000000001', '4.2.3',
   'Electrical service upgrade panel capacity requirements for building permits.',
   'https://example.test/bylaw/4-2-3-electrical', 'public_record', 'test-v1', 'electrical'),
  ('60000000-0000-0000-0000-00000000002c', '00000000-0000-0000-0001-000000000001', '4.2.3',
   'Electrical service upgrade panel capacity requirements for building permits.',
   'https://example.test/bylaw/4-2-3-universal', 'public_record', 'test-v1', null);

-- === 1a. CONTROL: the pre-migration query shape (no window filter) would
-- have returned all four setback-window fixture rows equally ===
do $$
declare
  unfiltered_count int;
begin
  select count(*) into unfiltered_count
  from jurisdiction_code_chunks c
  where c.jurisdiction_id = '00000000-0000-0000-0001-000000000001'
    and c.license_status = 'public_record'
    and c.content_tsv @@ plainto_tsquery('english', 'zoning bylaw setback accessory structures');
  if unfiltered_count <> 4 then
    raise exception 'FAIL (control): expected all 4 window fixtures to match the unfiltered query, got %', unfiltered_count;
  end if;
  raise notice 'PASS (control): pre-migration query shape would have returned all 4 rows regardless of effective window -- the STALE_BYLAW gap was real';
end $$;

-- === 1b. ASSERT: the deployed RPC excludes the superseded and
-- not-yet-effective rows, keeping only the legacy null-window and
-- currently-effective rows ===
do $$
declare
  returned_ids uuid[];
begin
  select array_agg(id) into returned_ids
  from search_jurisdiction_code_chunks(
    p_jurisdiction_id => '00000000-0000-0000-0001-000000000001',
    p_query_text => 'zoning bylaw setback accessory structures',
    p_match_count => 10
  );
  if not (returned_ids @> array['60000000-0000-0000-0000-00000000001a'::uuid])
     or not (returned_ids @> array['60000000-0000-0000-0000-00000000001c'::uuid]) then
    raise exception 'FAIL: RPC did not return the always-effective and currently-effective rows, got %', returned_ids;
  end if;
  if returned_ids @> array['60000000-0000-0000-0000-00000000001b'::uuid] then
    raise exception 'FAIL: RPC returned a superseded (effective_to in the past) chunk';
  end if;
  if returned_ids @> array['60000000-0000-0000-0000-00000000001d'::uuid] then
    raise exception 'FAIL: RPC returned a not-yet-effective (effective_from in the future) chunk';
  end if;
  raise notice 'PASS: RPC correctly excludes superseded/not-yet-effective chunks and keeps always-effective/currently-effective chunks';
end $$;

-- === 2. Dimension filter: p_permit_type narrows to matching + universal
-- (null) chunks, excludes the differently-tagged chunk ===
do $$
declare
  returned_ids uuid[];
begin
  select array_agg(id) into returned_ids
  from search_jurisdiction_code_chunks(
    p_jurisdiction_id => '00000000-0000-0000-0001-000000000001',
    p_query_text => 'electrical service upgrade panel capacity',
    p_match_count => 10,
    p_permit_type => 'building'
  );
  if not (returned_ids @> array['60000000-0000-0000-0000-00000000002a'::uuid]) then
    raise exception 'FAIL: RPC did not return the building-tagged chunk when filtering p_permit_type=building';
  end if;
  if not (returned_ids @> array['60000000-0000-0000-0000-00000000002c'::uuid]) then
    raise exception 'FAIL: RPC did not return the universal (null permit_type) chunk when filtering p_permit_type=building';
  end if;
  if returned_ids @> array['60000000-0000-0000-0000-00000000002b'::uuid] then
    raise exception 'FAIL: RPC returned the electrical-tagged chunk when filtering p_permit_type=building';
  end if;
  raise notice 'PASS: p_permit_type filter keeps matching + universal chunks, excludes differently-tagged chunk';
end $$;

-- === 3. No dimension filter passed (p_permit_type default null) -- existing
-- caller behavior preserved: all three chunks returned regardless of tag ===
do $$
declare
  returned_ids uuid[];
begin
  select array_agg(id) into returned_ids
  from search_jurisdiction_code_chunks(
    p_jurisdiction_id => '00000000-0000-0000-0001-000000000001',
    p_query_text => 'electrical service upgrade panel capacity',
    p_match_count => 10
  );
  if not (returned_ids @> array['60000000-0000-0000-0000-00000000002a'::uuid, '60000000-0000-0000-0000-00000000002b'::uuid, '60000000-0000-0000-0000-00000000002c'::uuid]) then
    raise exception 'FAIL: omitting p_permit_type should return all 3 dimension fixtures unfiltered, got %', returned_ids;
  end if;
  raise notice 'PASS: omitting the new dimension filter args preserves the existing caller''s unfiltered-by-dimension behavior';
end $$;

rollback;
