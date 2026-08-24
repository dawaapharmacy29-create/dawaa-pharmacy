-- Align Customer Requests V2 summary counters with the actual operational filters.
-- One definition is now shared conceptually by KPI cards, queue clicks and SLA/fulfillment logic.

create or replace function public.get_customer_requests_command_center_summary_v2(
  p_branch text default null
)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  with scoped as (
    select
      cr.*,
      coalesce(cr.requested_at,cr.created_at,now()) as request_ts,
      coalesce(cr.last_action_at,cr.updated_at,cr.requested_at,cr.created_at,now()) as stage_ts,
      lower(trim(coalesce(cr.status,'new'))) as status_key,
      regexp_replace(coalesce(cr.customer_phone,''),'[^0-9]','','g') as phone_digits,
      (
        coalesce(cr.is_urgent,false)
        or lower(trim(coalesce(cr.urgency,''))) in ('urgent','high','عاجل','مهم')
        or lower(trim(coalesce(cr.priority,'')))='high'
      ) as urgent_flag
    from public.customer_requests cr
    where (
      p_branch is null
      or trim(coalesce(p_branch,''))=''
      or lower(trim(p_branch))='all'
      or public.dawaa_customer_request_branch_key(cr.branch)=public.dawaa_customer_request_branch_key(p_branch)
    )
  ),
  aggregated as (
    select
      count(*)::int as total,
      count(*) filter (
        where (request_ts at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date
      )::int as today,
      count(*) filter (
        where status_key not in ('closed','delivered','cancelled')
      )::int as open,
      count(*) filter (
        where status_key not in ('closed','delivered','cancelled')
          and request_ts >= now()-interval '7 days'
      )::int as attention,
      count(*) filter (
        where status_key not in ('closed','delivered','cancelled') and urgent_flag
      )::int as urgent,
      count(*) filter (
        where status_key not in ('closed','delivered','cancelled','not_available')
          and now()-stage_ts > make_interval(hours => public.dawaa_customer_request_sla_hours(status_key,urgent_flag))
      )::int as overdue,
      count(*) filter (
        where status_key in ('purchasing_review','searching_suppliers','sourcing')
      )::int as searching,
      count(*) filter (
        where status_key in ('needs_customer_confirmation','customer_confirmed')
      )::int as waiting_customer,
      count(*) filter (
        where status_key in ('available','arrived')
      )::int as ready,
      count(*) filter (where status_key='delivered')::int as delivered,
      count(*) filter (where status_key='not_available')::int as not_available,
      count(*) filter (where status_key='cancelled')::int as cancelled,
      count(*) filter (where source_system='dawaawael')::int as from_dawaawael,
      count(*) filter (where customer_id is null)::int as unlinked_customer,
      count(*) filter (where nullif(trim(coalesce(branch,'')),'') is null)::int as no_branch,
      count(*) filter (
        where phone_digits='' or phone_digits ~ '^0+$' or length(phone_digits)<8
      )::int as invalid_phone,
      count(*) filter (
        where nullif(trim(coalesce(purchasing_assignee,'')),'') is null
          and nullif(trim(coalesce(source_assigned_employee,'')),'') is null
          and status_key not in ('closed','delivered','cancelled')
      )::int as unassigned,
      count(*) filter (where coalesce(sync_conflict,false))::int as sync_conflicts,
      count(*) filter (where shortage_item_id is not null)::int as moved_to_shortage,
      count(*) filter (
        where status_key not in ('closed','delivered','cancelled')
          and (
            next_action_at <= now()
            or (
              next_action_at is null
              and due_date is not null
              and due_date <= (now() at time zone 'Africa/Cairo')::date
            )
          )
      )::int as followup_due,
      round(
        100.0 * count(*) filter (
          where status_key in ('available','arrived','customer_contacted','delivered','closed')
        ) / nullif(count(*),0),
        1
      ) as fulfillment_rate,
      round(
        avg(extract(epoch from (closed_at-request_ts))/3600.0)
          filter (where status_key='delivered' and closed_at is not null),
        1
      ) as avg_fulfillment_hours
    from scoped
  )
  select jsonb_build_object(
    'total',total,
    'today',today,
    'open',open,
    'attention',attention,
    'urgent',urgent,
    'overdue',overdue,
    'searching',searching,
    'waiting_customer',waiting_customer,
    'ready',ready,
    'delivered',delivered,
    'not_available',not_available,
    'cancelled',cancelled,
    'from_dawaawael',from_dawaawael,
    'unlinked_customer',unlinked_customer,
    'no_branch',no_branch,
    'invalid_phone',invalid_phone,
    'unassigned',unassigned,
    'sync_conflicts',sync_conflicts,
    'moved_to_shortage',moved_to_shortage,
    'followup_due',followup_due,
    'fulfillment_rate',coalesce(fulfillment_rate,0),
    'avg_fulfillment_hours',coalesce(avg_fulfillment_hours,0)
  )
  from aggregated;
$$;

revoke all on function public.get_customer_requests_command_center_summary_v2(text) from public;
grant execute on function public.get_customer_requests_command_center_summary_v2(text)
  to anon, authenticated, service_role;
