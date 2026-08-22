create index if not exists idx_cashback_cycle_branch_status_value_v1 on public.customer_cashback_cycles(cycle_start,cycle_end,branch,status,cashback_value desc);

create or replace function public.get_customer_cashback_workspace_v1(p_cycle_start date,p_cycle_end date,p_branch text default null,p_status text default null,p_search text default null,p_offset integer default 0,p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = public as $$
with scoped as materialized (
  select id,customer_code,customer_name,customer_phone,branch,cycle_label,cycle_start,cycle_end,total_spent,cashback_rate,cashback_value,redeemed_value,remaining_value,status,notified_at,bconnect_updated_at,settled_at,notes
  from public.customer_cashback_cycles
  where cycle_start=p_cycle_start and cycle_end=p_cycle_end
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع','__all__','all') or branch=p_branch)
    and (p_status is null or btrim(p_status)='' or p_status in ('الكل','__all__','all') or status=p_status)
    and (p_search is null or btrim(p_search)='' or customer_code ilike '%'||p_search||'%' or customer_name ilike '%'||p_search||'%' or customer_phone ilike '%'||p_search||'%')
), page as (
  select * from scoped order by cashback_value desc nulls last,customer_name limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
), summary as (
  select count(*)::bigint total_rows,coalesce(sum(total_spent),0)::numeric total_spent,coalesce(sum(cashback_value),0)::numeric cashback_value,coalesce(sum(redeemed_value),0)::numeric redeemed_value,
    coalesce(sum(greatest(coalesce(cashback_value,0)-coalesce(redeemed_value,0),0)),0)::numeric remaining_value,count(*) filter(where notified_at is not null)::bigint notified_count,
    count(*) filter(where settled_at is not null or status='settled')::bigint settled_count,count(*) filter(where coalesce(redeemed_value,0)>0 and greatest(coalesce(cashback_value,0)-coalesce(redeemed_value,0),0)>0)::bigint partial_count,
    count(*) filter(where cashback_rate=3)::bigint rate3_count,count(*) filter(where cashback_rate=5)::bigint rate5_count from scoped
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),'summary',to_jsonb(s),'offset',greatest(p_offset,0),'limit',least(greatest(p_limit,1),200)) from summary s;
$$;
revoke all on function public.get_customer_cashback_workspace_v1(date,date,text,text,text,integer,integer) from public;
grant execute on function public.get_customer_cashback_workspace_v1(date,date,text,text,text,integer,integer) to authenticated;
