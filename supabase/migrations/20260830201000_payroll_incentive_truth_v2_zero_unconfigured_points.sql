-- Keep the payroll breakdown identical to the payable amount: unconfigured
-- compensation profiles must not expose fallback point-cash values as payable.

create or replace function public.get_payroll_incentive_truth_v2(
  p_staff_id uuid,
  p_month_cycle text
)
returns table(
  staff_id uuid,
  month_cycle text,
  profile_configured boolean,
  performance_source text,
  points_incentive_egp numeric,
  competition_bonus_egp numeric,
  manager_evaluation_incentive_egp numeric,
  performance_incentive_egp numeric,
  target_bonus_egp numeric,
  followup_threshold_bonus_egp numeric,
  customer_request_threshold_bonus_egp numeric,
  branch_star_bonus_egp numeric,
  automated_incentives_total_egp numeric,
  excluded_manager_evaluation_due_to_points_profile boolean
)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_profile_configured boolean := false;
  v_points_incentive numeric := 0;
  v_competition_bonus numeric := 0;
  v_manager_eval numeric := 0;
  v_target numeric := 0;
  v_followup numeric := 0;
  v_customer_request numeric := 0;
  v_branch_star numeric := 0;
  v_performance numeric := 0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid payroll incentive truth input' using errcode='22023';
  end if;

  select sa.username
    into v_username
  from public.staff_accounts sa
  where sa.staff_id = p_staff_id::text
    and coalesce(sa.active,true)=true
    and coalesce(sa.can_login,true)=true
  order by sa.created_at nulls last
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not authorized to read payroll incentive truth' using errcode='42501';
  end if;

  select
    coalesce(t.profile_configured,false),
    coalesce(t.points_incentive_egp,0),
    coalesce(t.competition_bonus_egp,0)
  into v_profile_configured,v_points_incentive,v_competition_bonus
  from public.dawaa_staff_points_truth_v2(p_staff_id,p_month_cycle) t
  limit 1;

  if not v_profile_configured then
    v_points_incentive := 0;
    v_competition_bonus := 0;
  end if;

  select
    coalesce(sum(et.amount) filter(where et.source='manager_evaluation_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='target_achievement_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_followup_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_customer_request_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='branch_star_of_month'),0)
  into v_manager_eval,v_target,v_followup,v_customer_request,v_branch_star
  from public.employee_transactions et
  where et.staff_id=p_staff_id
    and et.month_cycle=p_month_cycle
    and et.status in ('active','approved')
    and et.source in (
      'manager_evaluation_settlement',
      'target_achievement_settlement',
      'doctor_followup_threshold_bonus',
      'doctor_customer_request_threshold_bonus',
      'branch_star_of_month'
    );

  v_performance := case
    when v_profile_configured then v_points_incentive + v_competition_bonus
    else v_manager_eval
  end;

  return query select
    p_staff_id,
    p_month_cycle,
    v_profile_configured,
    case when v_profile_configured then 'points' when v_manager_eval<>0 then 'manager_evaluation' else 'none' end,
    v_points_incentive,
    v_competition_bonus,
    v_manager_eval,
    v_performance,
    v_target,
    v_followup,
    v_customer_request,
    v_branch_star,
    v_performance + v_target + v_followup + v_customer_request + v_branch_star,
    (v_profile_configured and v_manager_eval<>0);
end;
$function$;
