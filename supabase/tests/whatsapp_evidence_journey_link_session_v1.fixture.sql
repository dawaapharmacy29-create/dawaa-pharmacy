-- Minimal local fixture for the Evidence V17 link command (NOT a migration; never applied to Supabase).
-- Columns/helpers mirror the live definitions read on 2026-10-08. get_user_permissions is stubbed to
-- return staff_accounts.permissions (the live resolver composes role/page/override grants).
create extension if not exists pgcrypto with schema public;
create schema if not exists extensions;
create or replace function extensions.digest(text,text) returns bytea language sql immutable as $$ select public.digest($1,$2) $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
-- Supabase default privileges: new functions are executable by anon/authenticated/service_role.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public, extensions to anon, authenticated, service_role;

create table public.staff_accounts (
  id uuid primary key, staff_id text, username text, role text, branch text,
  active boolean, is_active boolean, can_login boolean, status text, auth_user_id uuid,
  permissions jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz
);
create table public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(), staff_account_id uuid references public.staff_accounts(id),
  token_hash text not null, created_at timestamptz default now(), expires_at timestamptz not null,
  last_used_at timestamptz, revoked_at timestamptz
);
create table public.whatsapp_review_sources (id uuid primary key, branch text, staff_id uuid);
create table public.whatsapp_customer_stories (id uuid primary key, story_key text);
create table public.whatsapp_customer_journeys (id uuid primary key, root_source_id uuid, story_id uuid references public.whatsapp_customer_stories(id));
create table public.whatsapp_customer_journey_sessions (journey_id uuid, source_id uuid, primary key (journey_id, source_id));
create table public.whatsapp_evidence_facts_v17 (
  id uuid primary key default gen_random_uuid(), source_id uuid references public.whatsapp_review_sources(id),
  journey_id uuid references public.whatsapp_customer_journeys(id), story_id uuid references public.whatsapp_customer_stories(id),
  fact_key text, updated_at timestamptz, unique (source_id, fact_key)
);
create table public.whatsapp_sales_opportunities_v17 (
  id uuid primary key default gen_random_uuid(), root_source_id uuid references public.whatsapp_review_sources(id),
  journey_id uuid references public.whatsapp_customer_journeys(id), story_id uuid references public.whatsapp_customer_stories(id),
  opportunity_key text, updated_at timestamptz, unique (root_source_id, opportunity_key)
);

create function public.dawaa_jsonb_has_true_any(p_permissions jsonb, p_keys text[]) returns boolean language sql immutable as $$
  select coalesce(bool_or(coalesce((p_permissions ->> k)::boolean, false)), false)
  from unnest(coalesce(p_keys, '{}'::text[])) as k where p_permissions ? k;
$$;
create function public.get_user_permissions(p_user_id uuid) returns jsonb language sql security definer set search_path to 'public' as $$
  select coalesce((select permissions from public.staff_accounts where id=p_user_id and coalesce(active,false) and coalesce(can_login,false)),'{}'::jsonb);
$$;
create function public.dawaa_customer_request_branch_key(p text) returns text language sql immutable as $$ select nullif(lower(btrim(coalesce(p,''))),'') $$;
create function public.dawaa_can_read_conversation_review_row_v2(p_actor_id uuid, p_staff_id uuid, p_doctor_id uuid, p_branch text, p_reviewer_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  with me as (select sa.* from public.staff_accounts sa where sa.id = p_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false) limit 1)
  select exists (
    select 1 from me
    where lower(trim(coalesce(me.role,''))) in ('general_manager','executive_manager','branches_manager','admin','team_dawaa_alpha')
      or me.id = p_reviewer_id or me.staff_id = p_staff_id::text or me.staff_id = p_doctor_id::text
      or (lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch)=public.dawaa_customer_request_branch_key(p_branch)))
$$;

-- The legacy V17 RPC exactly as live (header-resolved actor), with its live grants, so the migration's
-- retirement is exercised. dawaa_current_actor_can is reduced to its header path.
create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select public.dawaa_jsonb_has_true_any(permissions, required_permissions) from public.staff_accounts
    where id::text = nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-dawaa-user-id'), false)
$$;
create function public.dawaa_link_whatsapp_evidence_journey_v17(p_journey_id uuid, p_story_id uuid, p_source_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
end $function$;
grant execute on function public.dawaa_link_whatsapp_evidence_journey_v17(uuid,uuid,uuid[]) to public, anon, authenticated, service_role;
