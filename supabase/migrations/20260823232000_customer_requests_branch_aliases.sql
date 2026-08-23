create or replace function public.get_customer_requests_command_center_summary(
  p_branch text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select case
    when p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' then null
    when lower(trim(p_branch)) like '%شكري%' or lower(trim(p_branch)) like '%shokry%' then 'shokry'
    when lower(trim(p_branch)) like '%شامي%' or lower(trim(p_branch)) like '%shamy%' or lower(trim(p_branch)) like '%elshamy%' then 'elshamy'
    else lower(trim(p_branch))
  end as branch_key
), scoped as (
  select
    cr.*,
    coalesce(cr.requested_at, cr.created_at, now()) as request_ts,
    lower(trim(coalesce(cr.status, 'new'))) as status_key,
    lower(trim(coalesce(cr.urgency, ''))) as urgency_key,
    lower(trim(coalesce(cr.priority, ''))) as priority_key,
    regexp_replace(coalesce(cr.customer_phone, ''), '[^0-9]', '', 'g') as phone_digits,
    (
      coalesce(cr.is_urgent, false)
      or lower(trim(coalesce(cr.urgency, ''))) in ('urgent','high','عاجل','مهم')
      or lower(trim(coalesce(cr.priority, ''))) = 'high'
    ) as urgent_flag
  from public.customer_requests cr
  cross join params p
  where p.branch_key is null
    or case
      when lower(trim(coalesce(cr.branch, ''))) like '%شكري%' or lower(trim(coalesce(cr.branch, ''))) like '%shokry%' then 'shokry'
      when lower(trim(coalesce(cr.branch, ''))) like '%شامي%' or lower(trim(coalesce(cr.branch, ''))) like '%shamy%' or lower(trim(coalesce(cr.branch, ''))) like '%elshamy%' then 'elshamy'
      else lower(trim(coalesce(cr.branch, '')))
    end = p.branch_key
), aggregated as (
  select
    count(*)::int as total,
    count(*) filter (
      where (request_ts at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date
    )::int as today,
    count(*) filter (where status_key not in ('closed','delivered','cancelled','not_available'))::int as open,
    count(*) filter (where urgent_flag)::int as urgent,
    count(*) filter (
      where status_key not in ('closed','delivered','cancelled','not_available')
        and (
          (urgent_flag and request_ts < now() - interval '6 hours')
          or (not urgent_flag and request_ts < now() - interval '24 hours')
        )
    )::int as overdue,
    count(*) filter (where status_key in ('purchasing_review','searching_suppliers','sourcing'))::int as searching,
    count(*) filter (where status_key in ('needs_customer_confirmation','customer_confirmed'))::int as waiting_customer,
    count(*) filter (where status_key in ('available','arrived','customer_contacted'))::int as ready,
    count(*) filter (where status_key = 'delivered')::int as delivered,
    count(*) filter (where status_key = 'not_available')::int as not_available,
    count(*) filter (where status_key = 'cancelled')::int as cancelled,
    count(*) filter (where source_system = 'dawaawael')::int as from_dawaawael,
    count(*) filter (where customer_id is null)::int as unlinked_customer,
    count(*) filter (where nullif(trim(coalesce(branch,'')), '') is null)::int as no_branch,
    count(*) filter (where phone_digits = '' or phone_digits ~ '^0+$' or length(phone_digits) < 8)::int as invalid_phone,
    count(*) filter (
      where nullif(trim(coalesce(purchasing_assignee,'')), '') is null
        and nullif(trim(coalesce(source_assigned_employee,'')), '') is null
        and status_key not in ('closed','delivered','cancelled','not_available')
    )::int as unassigned,
    count(*) filter (where coalesce(sync_conflict,false))::int as sync_conflicts,
    count(*) filter (where shortage_item_id is not null)::int as moved_to_shortage,
    round(
      100.0 * count(*) filter (where status_key = 'delivered')
      / nullif(count(*) filter (where status_key in ('delivered','cancelled','not_available')), 0),
      1
    ) as fulfillment_rate,
    round(
      avg(extract(epoch from (closed_at - request_ts)) / 3600.0)
        filter (where status_key = 'delivered' and closed_at is not null),
      1
    ) as avg_fulfillment_hours
  from scoped
)
select jsonb_build_object(
  'total', total,
  'today', today,
  'open', open,
  'urgent', urgent,
  'overdue', overdue,
  'searching', searching,
  'waiting_customer', waiting_customer,
  'ready', ready,
  'delivered', delivered,
  'not_available', not_available,
  'cancelled', cancelled,
  'from_dawaawael', from_dawaawael,
  'unlinked_customer', unlinked_customer,
  'no_branch', no_branch,
  'invalid_phone', invalid_phone,
  'unassigned', unassigned,
  'sync_conflicts', sync_conflicts,
  'moved_to_shortage', moved_to_shortage,
  'fulfillment_rate', coalesce(fulfillment_rate, 0),
  'avg_fulfillment_hours', coalesce(avg_fulfillment_hours, 0)
)
from aggregated;
$$;

revoke execute on function public.get_customer_requests_command_center_summary(text) from public;
revoke execute on function public.get_customer_requests_command_center_summary(text) from anon;
grant execute on function public.get_customer_requests_command_center_summary(text) to authenticated, service_role;
