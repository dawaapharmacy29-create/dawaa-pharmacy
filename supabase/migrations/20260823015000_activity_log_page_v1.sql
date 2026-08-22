create or replace function public.get_activity_log_page_v1(
  p_search text default null,
  p_branch text default null,
  p_module text default null,
  p_user text default null,
  p_action text default null,
  p_date_from date default null,
  p_offset integer default 0,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
with params as (
  select
    nullif(btrim(coalesce(p_search,'')),'') as search_key,
    nullif(btrim(coalesce(p_branch,'')),'') as branch_key,
    nullif(btrim(coalesce(p_module,'')),'') as module_key,
    nullif(btrim(coalesce(p_user,'')),'') as user_key,
    nullif(btrim(coalesce(p_action,'')),'') as action_key,
    greatest(0,coalesce(p_offset,0)) as row_offset,
    least(200,greatest(1,coalesce(p_limit,100))) as row_limit
), filtered as materialized (
  select a.*
  from public.activity_log a cross join params p
  where (p.branch_key is null or coalesce(nullif(a.branch_name,''),a.branch,'غير محدد')=p.branch_key)
    and (p.module_key is null or coalesce(nullif(a.module,''),a.entity_type,'')=p.module_key)
    and (p.user_key is null or coalesce(a.user_name,'')=p.user_key)
    and (p.action_key is null or coalesce(nullif(a.operation,''),a.action,'')=p.action_key)
    and (p_date_from is null or (a.created_at at time zone 'Africa/Cairo')::date >= p_date_from)
    and (
      p.search_key is null
      or concat_ws(' ',a.user_name,a.user_role,a.operation,a.action,a.module,a.entity_type,a.entity_id,a.entity_title,a.target_type,a.target_id,a.route_path,a.details::text) ilike '%' || p.search_key || '%'
    )
), numbered as (
  select f.*,row_number() over(order by f.created_at desc,f.id desc) as rn
  from filtered f
), page_rows as (
  select n.*
  from numbered n cross join params p
  where n.rn > p.row_offset and n.rn <= p.row_offset+p.row_limit
  order by n.rn
)
select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'rn' order by r.rn) from page_rows r),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'today_count',(select count(*) from filtered where (created_at at time zone 'Africa/Cairo')::date=current_date),
  'week_count',(select count(*) from filtered where created_at >= now()-interval '7 days'),
  'unique_users',(select count(distinct coalesce(nullif(user_name,''),user_id::text)) from filtered),
  'source','activity_log'
);
$$;

revoke all on function public.get_activity_log_page_v1(text,text,text,text,text,date,integer,integer) from public;
grant execute on function public.get_activity_log_page_v1(text,text,text,text,text,date,integer,integer) to authenticated;
