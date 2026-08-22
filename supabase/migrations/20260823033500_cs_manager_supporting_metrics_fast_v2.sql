create index if not exists idx_customer_welcome_branch_sent_at_v2
on public.customer_welcome_tasks ((coalesce(nullif(branch,''),branch_name)), welcome_message_sent_at)
where welcome_message_sent_at is not null;

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
as $$
with bounds as (
  select least(coalesce(p_start,current_date),current_date) start_date,
    least(coalesce(p_end,current_date),current_date) end_date,
    nullif(public.normalize_cs_identity_name(p_responsible),'') responsible_key
), date_window as (
  select b.*,
    (b.start_date::timestamp at time zone 'Africa/Cairo') start_ts,
    ((b.end_date + 1)::timestamp at time zone 'Africa/Cairo') end_ts
  from bounds b
), review_stats as (
  select count(*)::bigint review_count,
    round(avg(coalesce(r.final_score,r.total_score)) filter(where coalesce(r.final_score,r.total_score) is not null),1) avg_score
  from public.conversation_sales_reviews r cross join date_window b
  where (
      (r.conversation_date is not null and r.conversation_date >= b.start_ts and r.conversation_date < b.end_ts)
      or (r.conversation_date is null and r.review_date is not null and r.review_date between b.start_date and b.end_date)
      or (r.conversation_date is null and r.review_date is null and r.created_at >= b.start_ts and r.created_at < b.end_ts)
    )
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or r.branch=p_branch)
    and (b.responsible_key is null or public.normalize_cs_identity_name(r.reviewer_name)=b.responsible_key)
), welcome_stats as (
  select count(*)::bigint sent_count,
    count(*) filter(where w.customer_replied_at is not null)::bigint replied_count
  from public.customer_welcome_tasks w cross join date_window b
  where w.welcome_message_sent_at >= b.start_ts and w.welcome_message_sent_at < b.end_ts
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or coalesce(nullif(w.branch,''),w.branch_name)=p_branch)
    and (b.responsible_key is null or public.normalize_cs_identity_name(w.assigned_to_name)=b.responsible_key)
), request_stats as (
  select count(*)::bigint open_count
  from public.customer_requests q cross join date_window b
  where lower(coalesce(q.status,'new')) not in ('closed','delivered','cancelled','not_available')
    and (p_branch is null or p_branch='' or p_branch in ('الكل','كل الفروع','all') or q.branch=p_branch)
    and (b.responsible_key is null or public.normalize_cs_identity_name(coalesce(nullif(q.primary_responsible_name,''),nullif(q.created_by_name,''),nullif(q.source_assigned_employee,'')))=b.responsible_key)
)
select jsonb_build_object(
  'start_date',b.start_date,'end_date',b.end_date,
  'review_count',coalesce(r.review_count,0),'avg_score',r.avg_score,
  'welcome_sent',coalesce(w.sent_count,0),'welcome_replied',coalesce(w.replied_count,0),
  'open_requests_now',coalesce(q.open_count,0)
)
from date_window b cross join review_stats r cross join welcome_stats w cross join request_stats q;
$$;

revoke all on function public.get_cs_manager_supporting_metrics_v1(text,date,date,text) from public;
grant execute on function public.get_cs_manager_supporting_metrics_v1(text,date,date,text) to authenticated;
