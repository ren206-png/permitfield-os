-- Extensions required by later migrations.
-- pgcrypto: gen_random_uuid() for all primary keys.
-- vector (pgvector): embedding column on jurisdiction_code_chunks (migration 0009).
create extension if not exists pgcrypto;
create extension if not exists vector;
