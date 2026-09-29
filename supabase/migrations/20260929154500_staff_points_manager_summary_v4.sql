-- Monthly incentive manager read model V4.
-- Keeps the raw points incentive separate from the evaluation multiplier and the
-- post-evaluation result so the UI never presents a pre-evaluation amount as final.

create or replace function public.get_staff_points_manager_summary_v4(
  p_month_cycle text default null,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  month_cycle text,
  reward_points numeric,
  deduction_points numeric,
  final_points numeric,
  progress_pct numeric,
  points_incentive_egp numeric,
  evaluation_multiplier_pct numeric,
  competition_bonus_egp numeric,
  final_incentive_egp numeric,
  max_incentive_egp numeric,
  pending_reward_points numeric,
  pending_deduction_points numeric,
  profile_configured boolean,
  evaluation_status text,
  evaluation_score numeric,
  payroll_finalized boolean
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_branch text := nullif(trim(coalesce(p_branch,'')),'');
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  if not (v_global or v_role in ('branch_manager','customer_service_manager')) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  if not v_global then
    if v_actor_branch is null then
      raise exception 'manager_branch_missing' using errcode='42501';
    end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch' using errcode='42501';
    end if;
    v_branch := v_actor_branch;
  end if;

  return query
  select
    t.staff_id,
    t.staff_name,
    t.staff_role,
    t.branch,
    t.month_cycle,
    t.reward_points,
    t.deduction_points,
    t.final_points,
    t.progress_pct,
    case when t.profile_configured then t.points_incentive_egp else null end,
    m.multiplier_pct,
    case when t.profile_configured then t.competition_bonus_egp else null end,
    case when t.profile_configured then t.final_incentive_egp else null end,
    case when t.profile_configured then t.max_incentive_egp else null end,
    t.pending_reward_points,
    t.pending_deduction_points,
    t.profile_configured,
    e.status,
    e.overall_score,
    exists(
      select 1
      from public.payroll_finalized_snapshots_v2 f
      where f.staff_id=t.staff_id
        and f.month_cycle=t.month_cycle
    )
  from public.staff s
  cross join lateral public.dawaa_staff_points_truth_v2(s.id,v_cycle) t
  left join public.staff_evaluation_incentive_multipliers m
    on m.staff_id=t.staff_id
   and m.month_cycle=t.month_cycle
  left join public.staff_monthly_manager_evaluations e
    on e.staff_id=t.staff_id
   and e.evaluation_month=to_date(t.month_cycle || '-01','YYYY-MM-DD')
  where coalesce(s.active,s.is_active,true)
    and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
    and (v_branch is null or s.branch=v_branch)
  order by t.branch,t.staff_name;
end;
$function$;

revoke all on function public.get_staff_points_manager_summary_v4(text,text)
  from public,anon;
grant execute on function public.get_staff_points_manager_summary_v4(text,text)
  to authenticated,service_role;

comment on function public.get_staff_points_manager_summary_v4(text,text)
  is 'Manager monthly incentive read model separating raw points incentive, approved evaluation multiplier, competition bonus, final incentive and payroll freeze state.';

notify pgrst,'reload schema';
