-- STAGING BOOTSTRAP 00 — Supabase platform shim (classification: platform).
-- Only for a throwaway native PostgreSQL that stands in for a fresh Supabase project. A real Supabase
-- staging project already has these roles, schemas and auth functions: skip this file there.
-- No production identifiers, connections or data.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema public;
create extension if not exists pg_trgm with schema public;
create or replace function extensions.digest(text, text) returns bytea language sql immutable as $$ select public.digest($1, $2) $$;
create or replace function extensions.digest(bytea, text) returns bytea language sql immutable as $$ select public.digest($1, $2) $$;
create or replace function extensions.gen_random_uuid() returns uuid language sql volatile as $$ select public.gen_random_uuid() $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
-- Supabase default privileges.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
