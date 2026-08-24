-- Align the Customer Request doctor-points projection with the canonical settlement contract.
-- Operational request KPIs and incentive settlement remain separate concerns.
-- This projection includes only requests that could actually enter the doctor-points policy.

create or replace view public.customer_request_doctor_points_summary_v1 as
with request_candidates as (
  select
    cr.id,
    public.resolve_customer_request_registrar_staff_id(cr) as staff_id,
    coalesce(cr.requested_at, cr.created_at, now()) as registered_at,
    public.customer_request_cycle_label(coalesce(cr.requested_at, cr.created_at, now())) as month_cycle,
    cr.status,
    (
      nullif(trim(coalesce(cr.customer_id,'')), '') is not null
      and nullif(trim(coalesce(cr.customer_code,'')), '') is not null
      and nullif(trim(coalesce(cr.medicine_name,'')), '') is not null
      and nullif(trim(coalesce(cr.product_code,'')), '') is not null
      and not coalesce(cr.sync_conflict,false)
      and coalesce(cr.doctor_notes,'') !~* '(مكرر|بالخطأ|duplicate)'
      and coalesce(cr.source_notes,'') !~* '(مكرر|بالخطأ|duplicate)'
    ) as identity_eligible
  from public.customer_requests cr
), request_eligible as (
  select
    rc.id,
    rc.staff_id,
    rc.month_cycle,
    rc.status,
    tier.tier_key
  from request_candidates rc
  join lateral (
    select sit.tier_key
    from public.staff_incentive_tiers sit
    where sit.staff_id = rc.staff_id
      and sit.tier_key in ('senior_doctor','mid_doctor','assistant')
    order by sit.updated_at desc nulls last, sit.created_at desc nulls last
    limit 1
  ) tier on true
  where rc.staff_id is not null
    and rc.identity_eligible
    and exists (
      select 1
      from public.customer_request_incentive_policy p
      where p.active = true
        and p.tier_key = tier.tier_key
        and p.effective_from <= rc.registered_at
    )
), request_base as (
  select
    re.staff_id,
    re.month_cycle,
    count(*) as eligible_registered_requests,
    count(*) filter (
      where re.status in ('available','arrived','customer_contacted','delivered','closed')
    ) as achieved_requests
  from request_eligible re
  group by re.staff_id, re.month_cycle
), point_base as (
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
), combined as (
  select
    coalesce(r.staff_id,p.staff_id) as staff_id,
    coalesce(r.month_cycle,p.month_cycle) as month_cycle,
    coalesce(r.eligible_registered_requests,0) as eligible_registered_requests,
    coalesce(r.achieved_requests,0) as achieved_requests,
    coalesce(p.registration_events,0) as registration_events,
    coalesce(p.achievement_events,0) as achievement_events,
    coalesce(p.registration_points,0) as registration_points,
    coalesce(p.achievement_points,0) as achievement_points,
    coalesce(p.total_points,0) as total_points
  from request_base r
  full outer join point_base p
    on p.staff_id=r.staff_id and p.month_cycle=r.month_cycle
  where coalesce(r.staff_id,p.staff_id) is not null
)
select
  c.staff_id,
  s.name as staff_name,
  s.branch,
  tier.tier_key,
  c.month_cycle,
  c.eligible_registered_requests,
  c.achieved_requests,
  case when c.eligible_registered_requests > 0
    then round(100.0 * c.achieved_requests / c.eligible_registered_requests, 2)
    else 0 end as achievement_rate,
  c.registration_events,
  c.achievement_events,
  c.registration_points,
  c.achievement_points,
  c.total_points
from combined c
left join public.staff s on s.id=c.staff_id
left join lateral (
  select sit.tier_key
  from public.staff_incentive_tiers sit
  where sit.staff_id=c.staff_id
    and sit.tier_key in ('senior_doctor','mid_doctor','assistant')
  order by sit.updated_at desc nulls last, sit.created_at desc nulls last
  limit 1
) tier on true;

-- The raw projection stays internal. Client reads must use the scoped RPCs introduced
-- by 20260824143000_scope_customer_request_points_reads_v2.sql.
revoke all on table public.customer_request_doctor_points_summary_v1 from public, anon, authenticated;
grant select on table public.customer_request_doctor_points_summary_v1 to service_role;
