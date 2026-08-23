create or replace function public.calculate_weekly_manager_metrics_v5(p_evaluation_type text,p_branch text,p_week_start date,p_week_end date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with base as materialized (
  select public.calculate_weekly_manager_metrics_v4(p_evaluation_type,p_branch,p_week_start,p_week_end) j
), q as materialized (
  select * from public.get_customer_service_weekly_queue_completion_v1(p_branch,p_week_start,p_week_end)
)
select case
  when p_evaluation_type='customer_service' and p_branch is not null then
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(base.j,'{daily_queues_total}',to_jsonb(coalesce(q.total_items,0)),true),
          '{daily_queues_handled}',to_jsonb(coalesce(q.total_handled,0)),true
        ),
        '{daily_queues_completion_rate}',case when q.completion_rate is not null then to_jsonb(q.completion_rate) else 'null'::jsonb end,true
      ),
      '{data_coverage,daily_queues}',to_jsonb(coalesce(q.days_counted,0)>0),true
    )
  else base.j
end
from base left join q on true;
$$;

revoke all on function public.calculate_weekly_manager_metrics_v5(text,text,date,date) from public;
grant execute on function public.calculate_weekly_manager_metrics_v5(text,text,date,date) to authenticated;
