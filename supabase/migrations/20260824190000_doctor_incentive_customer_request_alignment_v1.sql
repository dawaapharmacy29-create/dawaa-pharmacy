-- Align the doctor incentive dashboard with the canonical employee ledger
-- and the pharmacy 26 -> 25 points cycle.
--
-- Customer Request awards are written as:
--   source = 'customer_request_incentive'
--   status = 'approved'
-- They must contribute to both the total incentive and the "طلبات العملاء" pillar.

create or replace function public.calculate_staff_incentive_egp(
  p_staff_id uuid,
  p_month_cycle text default public.dawaa_current_points_cycle_label_v1()
)
returns table(
  staff_id uuid,
  staff_name text,
  tier_key text,
  total_points numeric,
  target_points integer,
  point_rate_egp numeric,
  base_incentive_egp numeric,
  stretch_cap_egp numeric,
  points_incentive_egp numeric,
  competition_bonus_egp numeric,
  final_incentive_egp numeric,
  progress_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tier as (
    select t.*, s.name as staff_name
    from public.staff_incentive_tiers t
    join public.staff s on s.id = t.staff_id
    where t.staff_id = p_staff_id
  ),
  points as (
    select coalesce(sum(coalesce(et.final_points, et.points_delta, 0)), 0) as total_points
    from public.employee_transactions et
    where et.staff_id = p_staff_id
      and et.month_cycle = p_month_cycle
      and et.status in ('active','approved')
  ),
  bonuses as (
    select coalesce(sum(prize_egp), 0) as competition_bonus_egp
    from public.pillar_competition_bonuses
    where winner_staff_id = p_staff_id
      and month_cycle = p_month_cycle
  )
  select
    tier.staff_id,
    tier.staff_name,
    tier.tier_key,
    p.total_points,
    tier.target_points,
    tier.point_rate_egp,
    (tier.target_points * tier.point_rate_egp)::numeric as base_incentive_egp,
    (tier.target_points * tier.point_rate_egp)::numeric as stretch_cap_egp,
    round(
      (least(greatest(p.total_points, 0), tier.target_points) * tier.point_rate_egp)::numeric,
      2
    ) as points_incentive_egp,
    b.competition_bonus_egp,
    round(
      (least(greatest(p.total_points, 0), tier.target_points) * tier.point_rate_egp)::numeric,
      2
    ) + b.competition_bonus_egp as final_incentive_egp,
    round(
      least(
        100,
        greatest(0, (p.total_points / nullif(tier.target_points, 0)) * 100)
      )::numeric,
      1
    ) as progress_pct
  from tier
  cross join points p
  cross join bonuses b;
$$;

create or replace function public.get_doctor_pillar_breakdown(
  p_staff_id uuid,
  p_month_cycle text default public.dawaa_current_points_cycle_label_v1()
)
returns table(
  pillar_key text,
  points numeric,
  has_competition_win boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with pillar_map(source, pillar_key) as (
    values
      ('conversation_evaluation','محادثات'),
      ('followup_activity_pillar','متابعات'),
      ('customer_request_incentive','طلبات العملاء'),
      ('stagnant_meds_points','الرواكد')
  ),
  summed as (
    select
      pm.pillar_key,
      coalesce(sum(coalesce(et.final_points, et.points_delta, 0)), 0) as points
    from pillar_map pm
    left join public.employee_transactions et
      on et.source = pm.source
      and et.staff_id = p_staff_id
      and et.month_cycle = p_month_cycle
      and et.status in ('active','approved')
    group by pm.pillar_key
  ),
  wins as (
    select pillar_key
    from public.pillar_competition_bonuses
    where winner_staff_id = p_staff_id
      and month_cycle = p_month_cycle
  )
  select
    s.pillar_key,
    s.points,
    exists(select 1 from wins w where w.pillar_key = s.pillar_key)
  from summed s
  union all
  select 'الالتزام', 0, false
  order by 1;
$$;

revoke all on function public.calculate_staff_incentive_egp(uuid,text) from public;
grant execute on function public.calculate_staff_incentive_egp(uuid,text)
  to anon, authenticated, service_role;

revoke all on function public.get_doctor_pillar_breakdown(uuid,text) from public;
grant execute on function public.get_doctor_pillar_breakdown(uuid,text)
  to anon, authenticated, service_role;

comment on function public.get_doctor_pillar_breakdown(uuid,text) is
  'Doctor incentive pillars backed by canonical employee_transactions; Customer Requests use source customer_request_incentive.';
