-- Employee Payroll Financial Composition V1
-- Read-only financial composition for transparent payroll review.
-- It intentionally avoids double-counting performance incentives:
-- performance_incentive_egp is already part of automated_incentives_total_egp.

create or replace function public.employee_payroll_financial_composition_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_gate jsonb;
  v_components jsonb;
  v_engine jsonb;
  v_incentives record;
  v_monthly public.staff_payroll_monthly_v13%rowtype;
  v_base numeric:=0;
  v_list numeric:=0;
  v_automated numeric:=0;
  v_performance numeric:=0;
  v_target numeric:=0;
  v_followup numeric:=0;
  v_customer_request numeric:=0;
  v_branch_star numeric:=0;
  v_overtime numeric:=0;
  v_manual_incentives numeric:=0;
  v_manual_adjustment numeric:=0;
  v_deductions numeric:=0;
  v_preview_net numeric:=0;
  v_frozen boolean:=false;
  v_final_net numeric:=null;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_financial_composition_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_financial_composition' using errcode='42501';
  end if;

  v_gate:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle);
  v_components:=coalesce(v_gate->'payroll_components','{}'::jsonb);
  v_engine:=coalesce(v_gate->'attendance_gate'->'engine','{}'::jsonb);

  select * into v_incentives
  from public.get_payroll_incentive_truth_v2(p_staff_id,p_month_cycle)
  limit 1;

  select * into v_monthly
  from public.staff_payroll_monthly_v13 m
  where m.staff_id=p_staff_id
    and m.payroll_month=to_date(p_month_cycle||'-01','YYYY-MM-DD')
  limit 1;

  v_base:=coalesce((v_components->>'base_salary_component')::numeric,0);
  v_list:=coalesce((v_components->>'list_incentive_component')::numeric,0);

  if v_incentives is not null then
    v_automated:=coalesce(v_incentives.automated_incentives_total_egp,0);
    v_performance:=coalesce(v_incentives.performance_incentive_egp,0);
    v_target:=coalesce(v_incentives.target_bonus_egp,0);
    v_followup:=coalesce(v_incentives.followup_threshold_bonus_egp,0);
    v_customer_request:=coalesce(v_incentives.customer_request_threshold_bonus_egp,0);
    v_branch_star:=coalesce(v_incentives.branch_star_bonus_egp,0);
  end if;

  v_overtime:=coalesce((v_engine->>'approved_overtime_amount')::numeric,0);

  if v_monthly.id is not null then
    v_manual_incentives:=coalesce(v_monthly.incentives_total,0);
    v_manual_adjustment:=coalesce(v_monthly.manual_adjustment,0);
    v_deductions:=
      coalesce(v_monthly.expiry_shortage_deduction,0)
      + coalesce(v_monthly.branch_general_deduction,0)
      + coalesce(v_monthly.individual_deduction,0)
      + coalesce(v_monthly.other_deduction,0);
    v_frozen:=v_monthly.status in ('approved','paid') and v_monthly.net_salary is not null;
    if v_frozen then
      v_final_net:=v_monthly.net_salary;
    end if;
  end if;

  v_preview_net:=round(
    v_base
    + v_automated
    + v_list
    + v_overtime
    + v_manual_incentives
    + v_manual_adjustment
    - v_deductions
  ,2);

  return jsonb_build_object(
    'schema','employee_payroll_financial_composition_v1',
    'staff_id',p_staff_id,
    'month_cycle',p_month_cycle,
    'ready_for_finalization',coalesce((v_gate->>'ready')::boolean,false),
    'source_mode',case
      when v_frozen then 'frozen_v13_snapshot'
      when v_monthly.id is not null then 'canonical_plus_legacy_manual_adjustments'
      else 'canonical_only_no_manual_adjustment_row'
    end,
    'earnings',jsonb_build_object(
      'base_salary',v_base,
      'automated_incentives_total',v_automated,
      'performance_incentive_included_in_automated_total',v_performance,
      'target_bonus_included_in_automated_total',v_target,
      'followup_bonus_included_in_automated_total',v_followup,
      'customer_request_bonus_included_in_automated_total',v_customer_request,
      'branch_star_bonus_included_in_automated_total',v_branch_star,
      'list_incentive',v_list,
      'approved_overtime',v_overtime,
      'manual_other_incentives',v_manual_incentives
    ),
    'adjustments',jsonb_build_object(
      'manual_adjustment',v_manual_adjustment,
      'deductions_total',v_deductions,
      'expiry_shortage_deduction',coalesce(v_monthly.expiry_shortage_deduction,0),
      'branch_general_deduction',coalesce(v_monthly.branch_general_deduction,0),
      'individual_deduction',coalesce(v_monthly.individual_deduction,0),
      'other_deduction',coalesce(v_monthly.other_deduction,0)
    ),
    'preview_net_salary',v_preview_net,
    'frozen',v_frozen,
    'frozen_net_salary',v_final_net,
    'display_net_salary',coalesce(v_final_net,v_preview_net),
    'double_count_guard',jsonb_build_object(
      'monthly_incentive_component_reference_only',
        coalesce((v_components->>'monthly_incentive_component')::numeric,0),
      'rule','performance incentive is included once inside automated_incentives_total'
    ),
    'blockers',coalesce(v_gate->'blockers','[]'::jsonb),
    'warnings',coalesce(v_gate->'warnings','[]'::jsonb),
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.employee_payroll_financial_composition_v1(uuid,text) from public,anon;
grant execute on function public.employee_payroll_financial_composition_v1(uuid,text)
  to authenticated,service_role;
