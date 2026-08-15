-- Rollback for 20260806000001_extensions.sql
-- Drops the two extensions installed by the forward migration. Safe only
-- once every later rollback (20260806000002 through 20260806000028) has
-- already been applied -- gen_random_uuid() is the default on nearly every
-- primary key in this schema, and the vector extension backs
-- jurisdiction_code_chunks.embedding (migration 0008/0014). Dropping either
-- extension while a dependent object still exists fails loud with a
-- Postgres dependency error, not silently.

drop extension if exists vector;
drop extension if exists pgcrypto;
