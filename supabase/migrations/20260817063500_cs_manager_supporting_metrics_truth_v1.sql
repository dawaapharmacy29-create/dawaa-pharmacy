-- Exact supporting metrics for Customer Service Manager dashboard.
-- Avoids client-side row caps and keeps employee/date scope explicit.
create or replace function public.get_cs_manager_supporting_metrics_v1(
  p_branch text default null,
  p_start date default (current_date - 29),
  p_end date default current_date,
  p_responsible text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with bounds as (
  select least(coalesce(p_start,current_date),current_date) as start_date,
         least(coalesce(p_end,current_date),current_date) as end_date,
         nullif(public.normalize_cs_identity_name(p_responsible),'') as responsible_key
), review_stats as (
  select
    count(*)::bigint as review_count,
    round(avg(coalesce(r.final_score,r.total_score)) filter(where coalesce(r.final_score,r.total_score) is not null),1) as avg_score
  from public.conversation_sales_reviews r cross join bounds b
  where coalesce(r.review_date,(r.created_at at time zone 'Africa/Cairo')::date) between b.start_date and b.end_date
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or r.branch=p_branch)
    and (b.responsible_key is null or public.normalize_cs_identity_name(r.reviewer_name)=b.responsible_key)
), welcome_stats as (
  select
    count(*) filter(where w.welcome_message_sent_at is not null)::bigint as sent_count,
    count(*) filter(where w.customer_replied_at is not null)::bigint as replied_count
  from public.customer_welcome_tasks w cross join bounds b
  where (w.created_at at time zone 'Africa/Cairo')::date between b.start_date and b.end_date
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or coalesce(nullif(w.branch,''),w.branch_name)=p_branch)
    and (b.responsible_key is null or public.normalize_cs_identity_name(w.assigned_to_name)=b.responsible_key)
), request_stats as (
  select count(*)::bigint as open_count
  from public.customer_requests q cross join bounds b
  where lower(coalesce(q.status,'')) not in ('مكتمل','مغلق','completed','closed','resolved','delivered')
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or q.branch=p_branch)
    and (
      b.responsible_key is null
      or public.normalize_cs_identity_name(coalesce(nullif(q.primary_responsible_name,''),nullif(q.created_by_name,''),nullif(q.source_assigned_employee,'')))=b.responsible_key
    )
)
select jsonb_build_object(
  'start_date',b.start_date,
  'end_date',b.end_date,
  'review_count',coalesce(r.review_count,0),
  'avg_score',r.avg_score,
  'welcome_sent',coalesce(w.sent_count,0),
  'welcome_replied',coalesce(w.replied_count,0),
  'open_requests_now',coalesce(q.open_count,0)
)
from bounds b cross join review_stats r cross join welcome_stats w cross join request_stats q;
$function$;

grant execute on function public.get_cs_manager_supporting_metrics_v1(text,date,date,text) to anon, authenticated;
