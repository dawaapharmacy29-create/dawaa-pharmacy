-- Performance Points Truth v2
-- One ledger -> one monthly points truth -> one incentive calculation.
-- Financial target bonuses stay separate from performance points.

create or replace view public.dawaa_employee_points_ledger_v2
with (security_invoker = true)
as
with normalized as (
  select
    et.*,
    case
      when coalesce(et.points_delta, 0) <> 0 then et.points_delta
      when coalesce(et.final_points, 0) <> 0 then
        case
          when lower(coalesce(et.type, '')) in ('penalty', 'deduction') then -abs(et.final_points)
          when lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(et.final_points)
          else et.final_points
        end
      when coalesce(et.points, 0) <> 0 then
        case
          when lower(coalesce(et.type, '')) in ('penalty', 'deduction') then -abs(et.points)
          when lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(et.points)
          else et.points
        end
      else 0::numeric
    end as signed_points,
    row_number() over (
      partition by
        et.staff_id,
        coalesce(et.month_cycle, ''),
        coalesce(et.source, ''),
        case when et.source_id is not null then et.source_id::text else et.id::text end
      order by
        case et.status when 'approved' then 1 when 'active' then 2 else 3 end,
        coalesce(et.updated_at, et.created_at) desc,
        et.id desc
    ) as event_rank
  from public.employee_transactions et
  where et.status in ('active', 'approved')
)
select
  id,
  staff_id,
  employee_id,
  employee_name,
  branch,
  month_cycle,
  type,
  title,
  reason,
  description,
  category,
  source,
  source_id,
  transaction_date,
  created_at,
  updated_at,
  signed_points,
  amount as money_amount,
  metadata
from normalized
where event_rank = 1;

comment on view public.dawaa_employee_points_ledger_v2 is
  'Canonical approved points ledger. Normalizes reward/penalty sign and deduplicates source events.';

create or replace view public.dawaa_evaluation_rule_catalog_v2
with (security_invoker = true)
as
select
  coalesce(nullif(btrim(er.rule_code), ''), nullif(btrim(er.rule_key), ''), er.id::text) as rule_code,
  coalesce(nullif(btrim(er.title), ''), nullif(btrim(er.name), ''), er.id::text) as title,
  coalesce(er.role_scope, er.applies_to_role, er.role, er.target_role, 'all') as role_scope,
  coalesce(er.category, 'تشغيل') as category,
  lower(coalesce(er.type, '')) as rule_type,
  er.impact_type,
  abs(coalesce(er.points, er.base_points, 0))::numeric as base_points,
  case
    when lower(coalesce(er.type, '')) in ('penalty', 'deduction')
      or lower(coalesce(er.impact_type, '')) in ('monthly_points_deduction', 'quarterly_money_deduction')
      then -abs(coalesce(er.points, er.base_points, 0))
    when lower(coalesce(er.type, '')) in ('reward', 'bonus')
      or lower(coalesce(er.impact_type, '')) in ('monthly_exceptional_reward', 'quarterly_money_reward')
      then abs(coalesce(er.points, er.base_points, 0))
    else coalesce(er.points, er.base_points, 0)
  end::numeric as signed_points,
  coalesce(er.requires_approval, false) as requires_approval,
  coalesce(er.repeat_multiplier, er.multiplier_enabled, false) as repeat_multiplier,
  coalesce(er.active, er.is_active, true) as active,
  er.source
from public.evaluation_rules er;

comment on view public.dawaa_evaluation_rule_catalog_v2 is
  'Normalized rule catalog where explicit penalty/reward type wins over stored numeric sign.';

create or replace function public.dawaa_staff_points_truth_v2(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  tier_key text,
  month_cycle text,
  starting_points numeric,
  reward_points numeric,
  deduction_points numeric,
  net_points_delta numeric,
  final_points numeric,
  distinction_points numeric,
  target_points integer,
  point_rate_egp numeric,
  max_incentive_egp numeric,
  points_incentive_egp numeric,
  competition_bonus_egp numeric,
  final_incentive_egp numeric,
  progress_pct numeric,
  pending_reward_points numeric,
  pending_deduction_points numeric,
  profile_configured boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff public.staff%rowtype;
  v_cycle text;
  v_profile record;
  v_tier text;
  v_starting numeric := 500;
  v_point_rate numeric := 3;
  v_max_incentive numeric := 1500;
  v_rewards numeric := 0;
  v_deductions numeric := 0;
  v_pending_rewards numeric := 0;
  v_pending_deductions numeric := 0;
  v_competition numeric := 0;
  v_final numeric := 0;
  v_profile_configured boolean := false;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if not found then
    return;
  end if;

  if not public.dawaa_can_read_employee_transaction(p_staff_id, v_staff.branch) then
    raise exception 'not_authorized';
  end if;

  v_cycle := coalesce(nullif(btrim(p_month_cycle), ''), public.dawaa_current_points_cycle_label_v1());

  select
    ecp.monthly_incentive_base,
    ecp.point_value
  into v_profile
  from public.employee_compensation_profiles ecp
  where ecp.staff_id = p_staff_id::text
    and coalesce(ecp.active, true)
    and coalesce(ecp.effective_from, current_date) <= current_date
  order by ecp.effective_from desc nulls last, ecp.updated_at desc nulls last
  limit 1;

  if found and coalesce(v_profile.monthly_incentive_base, 0) > 0 then
    v_profile_configured := true;
    v_max_incentive := v_profile.monthly_incentive_base;
    if coalesce(v_profile.point_value, 0) > 0 then
      v_point_rate := v_profile.point_value;
      v_starting := greatest(1, round(v_max_incentive / v_point_rate));
    end if;
  end if;

  select sit.tier_key into v_tier
  from public.staff_incentive_tiers sit
  where sit.staff_id = p_staff_id
  order by sit.updated_at desc nulls last, sit.created_at desc nulls last
  limit 1;

  select
    coalesce(sum(l.signed_points) filter (where l.signed_points > 0), 0),
    abs(coalesce(sum(l.signed_points) filter (where l.signed_points < 0), 0))
  into v_rewards, v_deductions
  from public.dawaa_employee_points_ledger_v2 l
  where l.staff_id = p_staff_id
    and l.month_cycle = v_cycle;

  select
    coalesce(sum(
      case
        when coalesce(et.points_delta, 0) > 0 then et.points_delta
        when coalesce(et.points_delta, 0) = 0 and lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(coalesce(et.points, 0))
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when coalesce(et.points_delta, 0) < 0 then abs(et.points_delta)
        when coalesce(et.points_delta, 0) = 0 and lower(coalesce(et.type, '')) in ('penalty', 'deduction') then abs(coalesce(et.points, 0))
        else 0
      end
    ), 0)
  into v_pending_rewards, v_pending_deductions
  from public.employee_transactions et
  where et.staff_id = p_staff_id
    and et.month_cycle = v_cycle
    and et.status = 'pending';

  select coalesce(sum(pcb.prize_egp), 0)
  into v_competition
  from public.pillar_competition_bonuses pcb
  where pcb.winner_staff_id = p_staff_id
    and pcb.month_cycle = v_cycle;

  v_final := greatest(0, v_starting + v_rewards - v_deductions);

  return query
  select
    p_staff_id,
    v_staff.name,
    v_staff.role,
    v_staff.branch,
    v_tier,
    v_cycle,
    v_starting,
    v_rewards,
    v_deductions,
    v_rewards - v_deductions,
    v_final,
    greatest(0, v_final - v_starting),
    v_starting::integer,
    v_point_rate,
    v_max_incentive,
    round(least(v_final, v_starting) / nullif(v_starting, 0) * v_max_incentive, 2),
    v_competition,
    round(least(v_final, v_starting) / nullif(v_starting, 0) * v_max_incentive, 2) + v_competition,
    round(least(100, v_final / nullif(v_starting, 0) * 100), 1),
    v_pending_rewards,
    v_pending_deductions,
    v_profile_configured;
end;
$$;

revoke all on function public.dawaa_staff_points_truth_v2(uuid, text) from public;
grant execute on function public.dawaa_staff_points_truth_v2(uuid, text) to authenticated;

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
  select
    t.staff_id,
    t.staff_name,
    t.tier_key,
    t.final_points as total_points,
    t.target_points,
    t.point_rate_egp,
    t.max_incentive_egp as base_incentive_egp,
    t.max_incentive_egp as stretch_cap_egp,
    t.points_incentive_egp,
    t.competition_bonus_egp,
    t.final_incentive_egp,
    t.progress_pct
  from public.dawaa_staff_points_truth_v2(p_staff_id, p_month_cycle) t;
$$;

revoke all on function public.calculate_staff_incentive_egp(uuid, text) from public;
grant execute on function public.calculate_staff_incentive_egp(uuid, text) to authenticated;

create or replace function public.get_doctor_live_incentive_total(p_doctor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_truth record;
  v_target_bonus numeric := 0;
  v_followup_bonus numeric := 0;
  v_request_bonus numeric := 0;
  v_star_bonus numeric := 0;
  v_total numeric := 0;
begin
  select * into v_truth
  from public.dawaa_staff_points_truth_v2(p_doctor_id, null)
  limit 1;

  if not found then
    return jsonb_build_object('error', 'staff_not_found_or_not_authorized');
  end if;

  select coalesce(sum(et.amount), 0) into v_target_bonus
  from public.employee_transactions et
  where et.staff_id = p_doctor_id
    and et.source = 'target_achievement_settlement'
    and et.month_cycle = v_truth.month_cycle
    and et.status in ('active', 'approved');

  select coalesce(sum(et.amount), 0) into v_followup_bonus
  from public.employee_transactions et
  where et.staff_id = p_doctor_id
    and et.source = 'doctor_followup_threshold_bonus'
    and et.month_cycle = v_truth.month_cycle
    and et.status in ('active', 'approved');

  select coalesce(sum(et.amount), 0) into v_request_bonus
  from public.employee_transactions et
  where et.staff_id = p_doctor_id
    and et.source = 'doctor_customer_request_threshold_bonus'
    and et.month_cycle = v_truth.month_cycle
    and et.status in ('active', 'approved');

  select coalesce(sum(et.amount), 0) into v_star_bonus
  from public.employee_transactions et
  where et.staff_id = p_doctor_id
    and et.source = 'branch_star_of_month'
    and et.month_cycle = v_truth.month_cycle
    and et.status in ('active', 'approved');

  v_total := v_truth.points_incentive_egp + v_target_bonus + v_followup_bonus + v_request_bonus + v_star_bonus;

  return jsonb_build_object(
    'starting_points', v_truth.starting_points,
    'reward_points', v_truth.reward_points,
    'deduction_points', v_truth.deduction_points,
    'net_points_delta', v_truth.net_points_delta,
    'final_points', v_truth.final_points,
    'target_points', v_truth.target_points,
    'distinction_points', v_truth.distinction_points,
    'point_rate_egp', v_truth.point_rate_egp,
    'base_incentive_egp', v_truth.points_incentive_egp,
    'max_incentive_egp', v_truth.max_incentive_egp,
    'target_bonus_egp', v_target_bonus,
    'followup_bonus_egp', v_followup_bonus,
    'request_bonus_egp', v_request_bonus,
    'star_bonus_egp', v_star_bonus,
    'total_expected_egp', v_total,
    'pending_reward_points', v_truth.pending_reward_points,
    'pending_deduction_points', v_truth.pending_deduction_points,
    'month_cycle', v_truth.month_cycle,
    'engine_version', 2
  );
end;
$$;

revoke all on function public.get_doctor_live_incentive_total(uuid) from public;
grant execute on function public.get_doctor_live_incentive_total(uuid) to authenticated;

create or replace function public.get_doctor_pillar_breakdown(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns table(pillar_key text, points numeric, has_competition_win boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with scope as (
    select t.month_cycle
    from public.dawaa_staff_points_truth_v2(p_staff_id, p_month_cycle) t
  ),
  mapped as (
    select
      case
        when l.source = 'conversation_evaluation' or l.category in ('جودة المحادثات', 'واتساب وجودة المحادثات', 'الواتساب والمحادثات') then 'محادثات'
        when l.source in ('followup_activity_pillar', 'followup_expire_auto') or l.category in ('المتابعات', 'خدمة العملاء') then 'متابعات'
        when l.source = 'customer_request_incentive' or l.category = 'طلبات العملاء' then 'طلبات العملاء'
        when l.source in ('stagnant_meds_points', 'stagnant') or l.category in ('الرواكد', 'مكافآت الرواكد') then 'الرواكد'
        when l.category in ('الالتزام والانضباط', 'الالتزام بالتطبيق', 'التشغيل', 'انضباط') or l.source in ('attendance', 'time_off', 'penalty_incentive') then 'الالتزام'
        else null
      end as pillar_key,
      l.signed_points
    from public.dawaa_employee_points_ledger_v2 l
    join scope sc on sc.month_cycle = l.month_cycle
    where l.staff_id = p_staff_id
  ),
  pillars(pillar_key) as (
    values ('محادثات'), ('متابعات'), ('طلبات العملاء'), ('الرواكد'), ('الالتزام')
  )
  select
    p.pillar_key,
    coalesce(sum(m.signed_points), 0)::numeric as points,
    exists (
      select 1
      from scope sc
      join public.pillar_competition_bonuses pcb
        on pcb.winner_staff_id = p_staff_id
       and pcb.month_cycle = sc.month_cycle
       and pcb.pillar_key = p.pillar_key
    ) as has_competition_win
  from pillars p
  left join mapped m on m.pillar_key = p.pillar_key
  group by p.pillar_key
  order by p.pillar_key;
$$;

revoke all on function public.get_doctor_pillar_breakdown(uuid, text) from public;
grant execute on function public.get_doctor_pillar_breakdown(uuid, text) to authenticated;

-- Keep the verified clean Sales Truth in target settlement, and use the cycle-end month
-- as the shared month_cycle label (26 Jul -> 25 Aug = 2026-08).
create or replace function public.settle_target_achievement_bonus_v1_internal(
  p_cycle_start date,
  p_cycle_end date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer := 0;
  v_cycle_label text;
  v_row record;
  v_amount numeric;
  v_achievement numeric;
  v_existing_id uuid;
begin
  if p_cycle_start is null or p_cycle_end is null
     or p_cycle_end < p_cycle_start
     or extract(day from p_cycle_start) <> 26
     or extract(day from p_cycle_end) <> 25 then
    raise exception 'target bonus cycle must run from day 26 to day 25';
  end if;

  v_cycle_label := to_char(p_cycle_end, 'YYYY-MM');

  for v_row in
    with branch_performance as (
      select
        replace(replace(coalesce(t.branch_name, ''), 'فرع ', ''), 'فرع', '') as branch_key,
        max(t.target_amount)::numeric as target_amount,
        coalesce(sum(coalesce(i.net_amount, i.net_total, i.discounted_amount, i.total_amount, i.amount, 0)), 0)::numeric as sales_amount
      from public.branch_sales_targets t
      left join public.dawaa_sales_invoices_dashboard_v1 i
        on replace(replace(coalesce(i.branch, i.branch_name, ''), 'فرع ', ''), 'فرع', '')
           = replace(replace(coalesce(t.branch_name, ''), 'فرع ', ''), 'فرع', '')
       and i.invoice_date >= p_cycle_start::timestamp
       and i.invoice_date < (p_cycle_end + 1)::timestamp
      where t.active is true and t.target_amount > 0
      group by 1
    ),
    total_performance as (
      select sum(target_amount) target_amount, sum(sales_amount) sales_amount from branch_performance
    ),
    eligible_staff as (
      select
        s.id staff_id,
        s.name staff_name,
        s.branch,
        s.role,
        case
          when lower(coalesce(s.role, '')) in ('branches_manager', 'مدير الفروع', 'مديرة الفروع') then 'branches_manager'
          when lower(coalesce(s.role, '')) in ('branch_manager', 'مدير فرع', 'مديرة فرع') then 'branch_manager'
          when lower(coalesce(s.role, '')) in ('صيدلاني', 'صيدلي', 'pharmacist', 'doctor', 'دكتور') then 'doctor'
          else null
        end bonus_role
      from public.staff s
      where coalesce(s.active, s.is_active, true)
    )
    select
      e.*,
      case when e.bonus_role = 'branches_manager' then tp.target_amount else bp.target_amount end target_amount,
      case when e.bonus_role = 'branches_manager' then tp.sales_amount else bp.sales_amount end sales_amount
    from eligible_staff e
    left join branch_performance bp
      on replace(replace(coalesce(e.branch, ''), 'فرع ', ''), 'فرع', '') = bp.branch_key
    cross join total_performance tp
    where e.bonus_role is not null
  loop
    if coalesce(v_row.target_amount, 0) <= 0 then continue; end if;

    v_achievement := round(v_row.sales_amount / v_row.target_amount * 100, 1);
    v_amount := case
      when v_row.bonus_role = 'doctor' and v_achievement >= 100 then 600
      when v_row.bonus_role = 'doctor' and v_achievement >= 90 then 450
      when v_row.bonus_role = 'doctor' then 0
      when v_achievement >= 100 then 1000
      when v_achievement >= 90 then 750
      else 0
    end;

    select id into v_existing_id
    from public.employee_transactions
    where staff_id = v_row.staff_id
      and source = 'target_achievement_settlement'
      and month_cycle = v_cycle_label
    limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions(
        staff_id, type, title, reason, amount, points, points_delta, source,
        transaction_date, month_cycle, branch, status, employee_name, created_by,
        description, category, employee_visible, metadata
      ) values (
        v_row.staff_id,
        'reward',
        'حافز تحقيق التارجت',
        'حافز تارجت مستقل عن حافز الأداء',
        v_amount,
        0,
        0,
        'target_achievement_settlement',
        p_cycle_end,
        v_cycle_label,
        v_row.branch,
        'active',
        v_row.staff_name,
        'system_automation',
        'تحقيق ' || v_achievement || '% من التارجت — حافز ' || v_amount || ' جنيه',
        'target_bonus',
        true,
        jsonb_build_object(
          'engine_version', 2,
          'bonus_role', v_row.bonus_role,
          'cycle_start', p_cycle_start,
          'cycle_end', p_cycle_end,
          'sales_amount', v_row.sales_amount,
          'target_amount', v_row.target_amount,
          'achievement_percent', v_achievement,
          'target_bonus_egp', v_amount,
          'sales_truth_source', 'dawaa_sales_invoices_dashboard_v1',
          'separate_from_performance_incentive', true
        )
      );
    else
      update public.employee_transactions
      set amount = v_amount,
          transaction_date = p_cycle_end,
          updated_at = now(),
          description = 'تحقيق ' || v_achievement || '% من التارجت — حافز ' || v_amount || ' جنيه',
          metadata = jsonb_build_object(
            'engine_version', 2,
            'bonus_role', v_row.bonus_role,
            'cycle_start', p_cycle_start,
            'cycle_end', p_cycle_end,
            'sales_amount', v_row.sales_amount,
            'target_amount', v_row.target_amount,
            'achievement_percent', v_achievement,
            'target_bonus_egp', v_amount,
            'sales_truth_source', 'dawaa_sales_invoices_dashboard_v1',
            'separate_from_performance_incentive', true
          )
      where id = v_existing_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.settle_target_achievement_bonus_v1_internal(date, date) from public;

create or replace function public.settle_target_achievement_bonus()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_count integer;
begin
  -- The scheduled job always settles the latest fully closed 26 -> 25 cycle.
  if extract(day from current_date) > 25 then
    v_cycle_end := (date_trunc('month', current_date) + interval '24 days')::date;
  else
    v_cycle_end := (date_trunc('month', current_date) - interval '1 month' + interval '24 days')::date;
  end if;
  v_cycle_start := (date_trunc('month', v_cycle_end) - interval '1 month' + interval '25 days')::date;

  if v_cycle_end >= current_date then
    return 0;
  end if;

  select public.settle_target_achievement_bonus_v1_internal(v_cycle_start, v_cycle_end)
  into v_count;
  return v_count;
end;
$$;

revoke all on function public.settle_target_achievement_bonus() from public;

-- Keep scheduled execution available to database owner / cron only.

create or replace function public.dawaa_points_integrity_check_v2()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'engine_version', 2,
    'current_cycle', public.dawaa_current_points_cycle_label_v1(),
    'active_approved_rows', (
      select count(*) from public.dawaa_employee_points_ledger_v2
      where month_cycle = public.dawaa_current_points_cycle_label_v1()
    ),
    'duplicate_source_events_removed', (
      select count(*)
      from (
        select staff_id, month_cycle, source, source_id, count(*) c
        from public.employee_transactions
        where status in ('active', 'approved') and source_id is not null
        group by 1,2,3,4
        having count(*) > 1
      ) d
    ),
    'penalty_rows_with_positive_storage', (
      select count(*) from public.dawaa_evaluation_rule_catalog_v2
      where rule_type in ('penalty', 'deduction') and base_points > 0 and signed_points < 0
    ),
    'target_cron_uses_clean_truth', position('dawaa_sales_invoices_dashboard_v1' in pg_get_functiondef('public.settle_target_achievement_bonus_v1_internal(date,date)'::regprocedure)) > 0,
    'target_cycle_label_uses_end_month', position('to_char(p_cycle_end' in pg_get_functiondef('public.settle_target_achievement_bonus_v1_internal(date,date)'::regprocedure)) > 0
  );
$$;

revoke all on function public.dawaa_points_integrity_check_v2() from public;
grant execute on function public.dawaa_points_integrity_check_v2() to authenticated;
