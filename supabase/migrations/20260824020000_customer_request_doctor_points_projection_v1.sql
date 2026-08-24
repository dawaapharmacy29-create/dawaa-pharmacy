-- Canonical read projection for Customer Request doctor performance and points.

create or replace view public.customer_request_doctor_points_summary_v1 as
with request_base as (
  select
    cr.doctor_id as staff_id,
    public.customer_request_cycle_label(coalesce(cr.requested_at,cr.created_at,now())) as month_cycle,
    count(*) filter (
      where cr.doctor_id is not null
        and cr.customer_id is not null
        and nullif(trim(coalesce(cr.customer_code,'')),'') is not null
        and nullif(trim(coalesce(cr.product_code,'')),'') is not null
        and not coalesce(cr.sync_conflict,false)
    ) as eligible_registered_requests,
    count(*) filter (
      where cr.status in ('available','arrived','customer_contacted','delivered','closed')
        and cr.doctor_id is not null
    ) as achieved_requests
  from public.customer_requests cr
  group by cr.doctor_id, public.customer_request_cycle_label(coalesce(cr.requested_at,cr.created_at,now()))
),
point_base as (
  select
    e.staff_id,
    public.customer_request_cycle_label(e.event_at) as month_cycle,
    count(*) filter (where e.event_key='request_registered') as registration_events,
    count(*) filter (where e.event_key='request_achieved') as achievement_events,
    coalesce(sum(e.points) filter (where e.event_key='request_registered'),0) as registration_points,
    coalesce(sum(e.points) filter (where e.event_key='request_achieved'),0) as achievement_points,
    coalesce(sum(e.points),0) as total_points
  from public.customer_request_incentive_events e
  group by e.staff_id, public.customer_request_cycle_label(e.event_at)
)
select
  coalesce(r.staff_id,p.staff_id) as staff_id,
  s.name as staff_name,
  s.branch,
  sit.tier_key,
  coalesce(r.month_cycle,p.month_cycle) as month_cycle,
  coalesce(r.eligible_registered_requests,0) as eligible_registered_requests,
  coalesce(r.achieved_requests,0) as achieved_requests,
  case when coalesce(r.eligible_registered_requests,0)>0
    then round(100.0 * coalesce(r.achieved_requests,0) / r.eligible_registered_requests,2)
    else 0 end as achievement_rate,
  coalesce(p.registration_events,0) as registration_events,
  coalesce(p.achievement_events,0) as achievement_events,
  coalesce(p.registration_points,0) as registration_points,
  coalesce(p.achievement_points,0) as achievement_points,
  coalesce(p.total_points,0) as total_points
from request_base r
full outer join point_base p
  on p.staff_id=r.staff_id and p.month_cycle=r.month_cycle
left join public.staff s on s.id=coalesce(r.staff_id,p.staff_id)
left join public.staff_incentive_tiers sit on sit.staff_id=coalesce(r.staff_id,p.staff_id)
where coalesce(r.staff_id,p.staff_id) is not null;

grant select on public.customer_request_doctor_points_summary_v1 to authenticated, service_role;
