begin;

-- Keep incentive policy, settlement events, catalogs, and historical repair
-- artifacts server-internal. Client reads go through actor-scoped RPCs and
-- client writes go through canonical settlement commands.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'notification_type_catalog',
    'staff_incentive_tiers',
    'customer_request_incentive_policy',
    'customer_request_incentive_events',
    'conversation_sales_reviews_backup_20260821_policy_recalc',
    'employee_transactions_backup_20260821_policy_recalc',
    'sales_invoices_reconcile_stage_20260819',
    'sales_invoices_snapshot_before_recovery_20260821',
    'customer_service_top50_cache'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
      execute format('grant all on table public.%I to service_role', v_table);
    end if;
  end loop;
end
$$;

-- The previous default expression called the private cycle helper before
-- entering the SECURITY DEFINER body. PostgreSQL evaluates argument defaults
-- with caller privileges, which caused doctor-dashboard permission failures.
-- Resolve the cycle inside the scoped body instead, and enforce staff/branch
-- authorization before any incentive data is returned.
create or replace function public.calculate_staff_incentive_egp(
  p_staff_id uuid,
  p_month_cycle text default null
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
set search_path = public, pg_catalog
as $$
  with cycle as (
    select coalesce(
      nullif(btrim(p_month_cycle), ''),
      public.dawaa_current_points_cycle_label_v1()
    ) as month_cycle
  ),
  tier as (
    select t.*, s.name as staff_name
    from public.staff_incentive_tiers t
    join public.staff s on s.id = t.staff_id
    where t.staff_id = p_staff_id
      and public.dawaa_can_read_employee_transaction(p_staff_id, s.branch)
  ),
  points as (
    select coalesce(sum(coalesce(et.final_points, et.points_delta, 0)), 0) as total_points
    from public.employee_transactions et
    cross join cycle c
    where et.staff_id = p_staff_id
      and et.month_cycle = c.month_cycle
      and et.status in ('active', 'approved')
  ),
  bonuses as (
    select coalesce(sum(pcb.prize_egp), 0) as competition_bonus_egp
    from public.pillar_competition_bonuses pcb
    cross join cycle c
    where pcb.winner_staff_id = p_staff_id
      and pcb.month_cycle = c.month_cycle
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
  p_month_cycle text default null
)
returns table(
  pillar_key text,
  points numeric,
  has_competition_win boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with scope as (
    select coalesce(
      nullif(btrim(p_month_cycle), ''),
      public.dawaa_current_points_cycle_label_v1()
    ) as month_cycle
    from public.staff s
    where s.id = p_staff_id
      and public.dawaa_can_read_employee_transaction(p_staff_id, s.branch)
  ),
  pillar_map(source, pillar_key) as (
    values
      ('conversation_evaluation', 'محادثات'),
      ('followup_activity_pillar', 'متابعات'),
      ('customer_request_incentive', 'طلبات العملاء'),
      ('stagnant_meds_points', 'الرواكد')
  ),
  summed as (
    select
      pm.pillar_key,
      coalesce(sum(coalesce(et.final_points, et.points_delta, 0)), 0) as points
    from scope sc
    cross join pillar_map pm
    left join public.employee_transactions et
      on et.source = pm.source
      and et.staff_id = p_staff_id
      and et.month_cycle = sc.month_cycle
      and et.status in ('active', 'approved')
    group by pm.pillar_key
  ),
  wins as (
    select pcb.pillar_key
    from scope sc
    join public.pillar_competition_bonuses pcb
      on pcb.winner_staff_id = p_staff_id
      and pcb.month_cycle = sc.month_cycle
  )
  select
    s.pillar_key,
    s.points,
    exists(select 1 from wins w where w.pillar_key = s.pillar_key)
  from summed s
  union all
  select 'الالتزام', 0, false
  from scope
  order by 1;
$$;

revoke all on function public.calculate_staff_incentive_egp(uuid, text) from public;
revoke all on function public.get_doctor_pillar_breakdown(uuid, text) from public;
grant execute on function public.calculate_staff_incentive_egp(uuid, text)
  to anon, authenticated, service_role;
grant execute on function public.get_doctor_pillar_breakdown(uuid, text)
  to anon, authenticated, service_role;

-- The helper remains internal now that no client-facing default expression
-- depends on it.
revoke all on function public.dawaa_current_points_cycle_label_v1()
  from public, anon, authenticated;
grant execute on function public.dawaa_current_points_cycle_label_v1()
  to service_role;

comment on function public.calculate_staff_incentive_egp(uuid, text) is
  'Actor-scoped incentive projection. Cycle resolution occurs inside the protected body.';
comment on function public.get_doctor_pillar_breakdown(uuid, text) is
  'Actor-scoped doctor pillar projection. Cycle resolution occurs inside the protected body.';

commit;
