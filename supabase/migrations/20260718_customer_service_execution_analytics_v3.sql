begin;

create extension if not exists pgcrypto;

create table if not exists public.customer_service_escalation_log (
  id uuid primary key default gen_random_uuid(),
  alert_date date not null,
  branch text not null,
  alert_key text not null,
  alert_level text not null default 'warning',
  alert_type text not null,
  title text not null,
  message text not null,
  total_count integer not null default 0,
  completed_count integer not null default 0,
  remaining_count integer not null default 0,
  needs_manager_count integer not null default 0,
  acknowledged boolean not null default false,
  acknowledged_by_staff_id text,
  acknowledged_by_name text,
  acknowledged_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists customer_service_escalation_log_identity_uidx
  on public.customer_service_escalation_log (alert_date, branch, alert_key);

create index if not exists customer_service_escalation_log_open_idx
  on public.customer_service_escalation_log (alert_date desc, branch, alert_level)
  where acknowledged = false;

create or replace view public.customer_service_daily_execution_metrics as
select
  q.queue_date,
  q.branch,
  count(*)::integer as total_count,
  count(*) filter (where q.status = 'completed')::integer as completed_count,
  count(*) filter (where q.status <> 'completed')::integer as remaining_count,
  count(*) filter (where q.status = 'not_started')::integer as not_started_count,
  count(*) filter (where q.status = 'in_progress')::integer as in_progress_count,
  count(*) filter (where q.status = 'scheduled')::integer as scheduled_count,
  count(*) filter (where q.status = 'needs_manager')::integer as needs_manager_count,
  count(*) filter (where q.source = 'doctor_request')::integer as doctor_request_count,
  count(*) filter (where q.source = 'at_risk')::integer as at_risk_count,
  count(*) filter (where q.source = 'important')::integer as important_count,
  count(*) filter (where q.started_at is not null)::integer as started_count,
  round(
    case when count(*) = 0 then 0
    else (count(*) filter (where q.status = 'completed')::numeric / count(*)::numeric) * 100
    end,
    2
  ) as completion_rate,
  round(avg(extract(epoch from (q.started_at - q.created_at)) / 60.0)
    filter (where q.started_at is not null), 2) as avg_first_attempt_minutes,
  round(avg(extract(epoch from (q.completed_at - q.started_at)) / 60.0)
    filter (where q.completed_at is not null and q.started_at is not null), 2) as avg_completion_minutes,
  min(q.started_at) as first_started_at,
  max(q.completed_at) as last_completed_at,
  max(q.updated_at) as last_activity_at
from public.customer_service_daily_queue_items q
group by q.queue_date, q.branch;

create or replace view public.customer_service_followup_event_metrics as
select
  coalesce(q.queue_date, e.created_at::date) as metric_date,
  coalesce(q.branch, 'غير محدد') as branch,
  e.event_type,
  coalesce(e.event_status, 'غير محدد') as event_status,
  count(*)::integer as events_count,
  count(distinct e.followup_id)::integer as followups_count,
  count(distinct e.actor_staff_id)::integer as actors_count,
  min(e.created_at) as first_event_at,
  max(e.created_at) as last_event_at
from public.customer_service_followup_events e
left join public.customer_service_daily_queue_items q
  on q.id = e.queue_item_id
group by
  coalesce(q.queue_date, e.created_at::date),
  coalesce(q.branch, 'غير محدد'),
  e.event_type,
  coalesce(e.event_status, 'غير محدد');

create or replace view public.customer_service_queue_quality_issues as
select
  q.id,
  q.queue_date,
  q.branch,
  q.customer_key,
  q.customer_code,
  q.customer_name,
  q.customer_phone,
  q.source,
  q.status,
  q.linked_followup_id,
  q.next_followup_date,
  case
    when coalesce(trim(q.customer_name), '') = '' then 'missing_customer_name'
    when coalesce(trim(q.customer_key), '') = '' then 'missing_customer_key'
    when coalesce(trim(q.customer_code), '') = '' and coalesce(trim(q.customer_phone), '') = '' then 'missing_customer_identity'
    when q.status in ('in_progress', 'scheduled', 'needs_manager', 'completed') and q.linked_followup_id is null then 'missing_followup_link'
    when q.status = 'scheduled' and q.next_followup_date is null then 'scheduled_without_date'
    when q.status = 'completed' and q.completed_at is null then 'completed_without_timestamp'
    when q.status <> 'completed' and q.queue_date < current_date then 'overdue_open_item'
    else null
  end as issue_type,
  q.created_at,
  q.updated_at
from public.customer_service_daily_queue_items q
where
  coalesce(trim(q.customer_name), '') = ''
  or coalesce(trim(q.customer_key), '') = ''
  or (coalesce(trim(q.customer_code), '') = '' and coalesce(trim(q.customer_phone), '') = '')
  or (q.status in ('in_progress', 'scheduled', 'needs_manager', 'completed') and q.linked_followup_id is null)
  or (q.status = 'scheduled' and q.next_followup_date is null)
  or (q.status = 'completed' and q.completed_at is null)
  or (q.status <> 'completed' and q.queue_date < current_date);

alter table public.customer_service_escalation_log enable row level security;

drop policy if exists customer_service_escalation_log_app_access
  on public.customer_service_escalation_log;
create policy customer_service_escalation_log_app_access
  on public.customer_service_escalation_log
  for all to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.customer_service_escalation_log to anon, authenticated;
grant select on public.customer_service_daily_execution_metrics to anon, authenticated;
grant select on public.customer_service_followup_event_metrics to anon, authenticated;
grant select on public.customer_service_queue_quality_issues to anon, authenticated;

commit;
