-- Fixture for 20261016130000_at_risk_completion_read_only_v1. get_customer_service_at_risk_daily_v2,
-- log_at_risk_snapshot_v1 and get_customer_service_at_risk_completion_v1 are the exact Production definitions
-- (2026-10-16); the queue core and the scope are table/GUC-driven stand-ins (their definitions are not changed).
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.at_risk_pool (branch text, customer_code text, save_priority text);
create table public.daily_followups (branch text, customer_code text, date text);
create table public.customer_service_queue_daily_snapshot (
  snapshot_date date, branch text, customer_code text, queue_type text, save_priority text,
  primary key (snapshot_date, branch, customer_code, queue_type)
);

-- Scope: the actor id maps to a branch scope ('ALL' or a lowercase branch) through test_actor_scopes.
create table public.test_actor_scopes (actor_id uuid primary key, scope text);
create or replace function public.dawaa_customer_service_queue_scope_v3(p_actor_id uuid)
returns text language sql stable security definer set search_path to 'public'
as $$ select scope from public.test_actor_scopes where actor_id = p_actor_id $$;

create or replace function public.get_customer_service_at_risk_daily_core(p_date date, p_scope text)
returns table(daily_order integer, branch text, customer_code text, customer_name text, customer_phone text, total_spent numeric,
  avg_invoice numeric, days_inactive integer, last_purchase date, save_priority text)
language sql stable security definer set search_path to 'public'
as $$
  select row_number() over (order by p.branch, p.customer_code)::integer, p.branch, p.customer_code, 'name', '010', 0::numeric, 0::numeric,
    0, null::date, p.save_priority
  from public.at_risk_pool p
  where p_scope = 'ALL' or lower(btrim(p.branch)) = p_scope
$$;

-- Production definitions (2026-10-16).
CREATE OR REPLACE FUNCTION public.log_at_risk_snapshot_v1(p_date date, p_scope text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  insert into public.customer_service_queue_daily_snapshot (snapshot_date, branch, customer_code, queue_type, save_priority)
  select p_date, r.branch, r.customer_code, 'at_risk', r.save_priority
  from public.get_customer_service_at_risk_daily_core(p_date, p_scope) r
  on conflict (snapshot_date, branch, customer_code, queue_type) do nothing;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_service_at_risk_daily_v2(p_date date, p_actor_id uuid)
 RETURNS TABLE(daily_order integer, branch text, customer_code text, customer_name text, customer_phone text, total_spent numeric, avg_invoice numeric, days_inactive integer, last_purchase date, save_priority text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_scope text := public.dawaa_customer_service_queue_scope_v3(p_actor_id);
begin
  perform public.log_at_risk_snapshot_v1(p_date, v_scope);
  return query select * from public.get_customer_service_at_risk_daily_core(p_date, v_scope);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_service_at_risk_completion_v1(p_date date DEFAULT CURRENT_DATE, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(branch text, at_risk_total integer, at_risk_handled integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with q as (
    select * from public.get_customer_service_at_risk_daily_v2(p_date, p_actor_id)
  )
  select q.branch, count(*)::integer,
    count(*) filter (
      where exists (
        select 1 from public.daily_followups f
        where f.branch = q.branch and btrim(f.customer_code) = q.customer_code and f.date = p_date::text
      )
    )::integer
  from q
  group by q.branch;
$function$;

insert into public.at_risk_pool values
  ('فرع شكري', 'C1', 'p'), ('فرع شكري', 'C2', 'p'), ('فرع شكري', 'C3', 'p'), ('فرع الشامي', 'S1', 'p'), ('فرع الشامي', 'S2', 'p');
insert into public.daily_followups values ('فرع شكري', ' C2 ', '2026-10-16'), ('فرع الشامي', 'S1', '2026-10-15');
insert into public.test_actor_scopes values
  ('00000000-0000-4000-8000-0000000000a1', 'ALL'), ('00000000-0000-4000-8000-0000000000a2', 'فرع شكري');

-- Expected results: the Production function in a writable transaction (where its snapshot insert succeeds).
create table public.test_expected (actor text, result text);
insert into public.test_expected
select a, (select string_agg(branch || ':' || at_risk_total || '/' || at_risk_handled, ',' order by branch)
           from public.get_customer_service_at_risk_completion_v1('2026-10-16', a::uuid))
from unnest(array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2']) a;
truncate public.customer_service_queue_daily_snapshot;
