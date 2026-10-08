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

-- The legacy V17 RPC with its live body and live grants (PUBLIC/anon/authenticated/service_role), so the
-- tests can prove the Phase A migration leaves it byte-for-byte and grant-for-grant untouched.
-- dawaa_current_actor_can / _strict are reduced to their header path (plpgsql resolves them lazily).
create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select public.dawaa_jsonb_has_true_any(permissions, required_permissions) from public.staff_accounts
    where id::text = nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-dawaa-user-id'), false)
$$;
CREATE OR REPLACE FUNCTION public.dawaa_link_whatsapp_evidence_journey_v17(p_journey_id uuid, p_story_id uuid, p_source_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.dawaa_current_actor_can(array['add_reviews','reviews.action.create','edit_reviews','approve_reviews','manage_conversation_evaluations']) then raise exception 'not authorized'; end if;
  if p_journey_id is null or coalesce(array_length(p_source_ids,1),0)=0 then return; end if;
  if exists (
    select 1 from unnest(p_source_ids) sid
    left join public.whatsapp_review_sources s on s.id=sid
    where s.id is null or not public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(),s.staff_id,null::uuid,s.branch,null::uuid)
  ) then raise exception 'source access denied'; end if;
  update public.whatsapp_evidence_facts_v17 set journey_id=p_journey_id,story_id=coalesce(p_story_id,story_id),updated_at=now() where source_id=any(p_source_ids);
  update public.whatsapp_sales_opportunities_v17 set journey_id=p_journey_id,story_id=coalesce(p_story_id,story_id),updated_at=now() where root_source_id=any(p_source_ids);
end $function$;
grant execute on function public.dawaa_link_whatsapp_evidence_journey_v17(uuid,uuid,uuid[]) to public, anon, authenticated, service_role;

-- Pre-migration snapshot of the legacy RPC (definition, owner, security, config, ACL).
create table public.t_legacy_snapshot as
select p.oid as fn_oid, md5(pg_get_functiondef(p.oid)) as def_md5, p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
from pg_proc p where p.oid = 'public.dawaa_link_whatsapp_evidence_journey_v17(uuid,uuid,uuid[])'::regprocedure;
