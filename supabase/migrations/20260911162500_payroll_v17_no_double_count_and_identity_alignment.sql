-- Payroll V17 hardening:
-- 1) monthly_incentive_base is a compensation cap/configuration input, not an unconditional salary addition.
-- 2) the earned monthly performance incentive is exposed as monthly_incentive_component.
-- 3) V16 already adds the full automated incentive truth; therefore V17 bridge must NOT add performance again.
-- 4) business branch identity prefers public.staff.branch, while account branch mismatch is exposed for audit.

create or replace function public.get_payroll_components_v17(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_staff_name text;
  v_branch text;
  v_account_branch text;
  v_profile public.employee_compensation_profiles%rowtype;
  v_truth record;
  v_base numeric := 0;
  v_monthly numeric := 0;
  v_monthly_cap numeric := 0;
  v_list numeric := 0;
  v_list_items jsonb := '[]'::jsonb;
  v_target numeric := 0;
  v_performance numeric := 0;
  v_automated numeric := 0;
  v_other_automated numeric := 0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_components_input' using errcode='22023';
  end if;

  select
    sa.username,
    coalesce(sa.name,sa.staff_name,s.name,sa.username),
    coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),'')),
    nullif(trim(sa.branch),'')
  into v_username,v_staff_name,v_branch,v_account_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc, sa.created_at desc nulls last
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select * into v_profile
  from public.employee_compensation_profiles p
  where p.staff_id=p_staff_id::text and coalesce(p.active,true)
  limit 1;

  if found then
    v_base := case
      when coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='monthly_hour_unit'
        then round(coalesce(v_profile.monthly_hour_unit_value,0)*coalesce(v_profile.contracted_daily_hours,0),2)
      else coalesce(v_profile.monthly_base_salary,0)
    end;
    v_monthly_cap := coalesce(v_profile.monthly_incentive_base,0);
  end if;

  select
    coalesce(sum(s.incentive_total),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'medicine_id',s.medicine_id,
      'product_name',s.product_name,
      'quantity',s.quantity,
      'incentive_per_unit',s.incentive_per_unit,
      'incentive_total',s.incentive_total
    ) order by s.product_name) filter (where s.product_name is not null),'[]'::jsonb)
  into v_list, v_list_items
  from (
    select ims.medicine_id,
           max(ims.product_name) product_name,
           sum(coalesce(ims.quantity,0)) quantity,
           case when sum(coalesce(ims.quantity,0))<>0
                then round(sum(coalesce(ims.incentive_total,0))/sum(coalesce(ims.quantity,0)),2)
                else 0 end incentive_per_unit,
           sum(coalesce(ims.incentive_total,0)) incentive_total
    from public.incentive_medicine_sales ims
    where ims.doctor_id=p_staff_id::text and ims.month_cycle=p_month_cycle
    group by ims.medicine_id
  ) s;

  select * into v_truth
  from public.get_payroll_incentive_truth_v2(p_staff_id,p_month_cycle)
  limit 1;

  v_target := coalesce(v_truth.target_bonus_egp,0);
  v_performance := coalesce(v_truth.performance_incentive_egp,0);
  v_monthly := v_performance;
  v_automated := coalesce(v_truth.automated_incentives_total_egp,0);
  v_other_automated := v_automated - v_performance;

  return jsonb_build_object(
    'engine_version',17,
    'staff_id',p_staff_id,
    'staff_username',v_username,
    'staff_name',v_staff_name,
    'branch',v_branch,
    'account_branch',v_account_branch,
    'identity_branch_mismatch',coalesce(v_branch,'')<>coalesce(v_account_branch,''),
    'month_cycle',p_month_cycle,
    'salary_calculation_mode',coalesce(v_profile.salary_calculation_mode,'legacy_fixed'),
    'monthly_hour_unit_value',coalesce(v_profile.monthly_hour_unit_value,0),
    'contracted_daily_hours',coalesce(v_profile.contracted_daily_hours,0),
    'base_salary_component',v_base,
    'monthly_incentive_cap',v_monthly_cap,
    'monthly_incentive_component',v_monthly,
    'overtime_hour_rate',coalesce(v_profile.overtime_hour_rate,0),
    'list_incentive_component',v_list,
    'list_items',v_list_items,
    'target_bonus_component',v_target,
    'performance_incentive_component',v_performance,
    'automated_incentives_total',v_automated,
    'other_automated_incentives_total',v_other_automated,
    'quarterly_incentive_archived',true
  );
end;
$function$;

create or replace function public.save_staff_payroll_monthly_v17(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_manual_incentives numeric default 0,
  p_expiry_shortage_deduction numeric default 0,
  p_branch_general_deduction numeric default 0,
  p_individual_deduction numeric default 0,
  p_other_deduction numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
)
returns public.staff_payroll_monthly_v13
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_status text := lower(trim(coalesce(p_status,'draft')));
  v_staff_id uuid;
  v_staff_name text;
  v_staff_role text;
  v_branch text;
  v_components jsonb;
  v_base numeric := 0;
  v_monthly numeric := 0;
  v_list numeric := 0;
  v_overtime_rate numeric := 0;
  v_overtime numeric := 0;
  v_total_deductions numeric := 0;
  v_bridge_adjustment numeric := 0;
  v_existing public.staff_payroll_monthly_v13%rowtype;
  v_saved public.staff_payroll_monthly_v13%rowtype;
begin
  if coalesce(trim(p_staff_username),'')='' or p_payroll_month is null then
    raise exception 'invalid_payroll_input' using errcode='22023';
  end if;
  if v_status not in ('draft','review','approved','paid') then
    raise exception 'invalid_payroll_status' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_v1(p_staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select
    s.id,
    coalesce(sa.name,sa.staff_name,s.name,sa.username),
    coalesce(sa.role,s.role),
    coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),''))
  into v_staff_id,v_staff_name,v_staff_role,v_branch
  from public.staff_accounts sa
  join public.staff s on s.id::text=sa.staff_id::text
  where sa.username=p_staff_username
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_staff_id is null then
    raise exception 'payroll_staff_identity_missing' using errcode='22023';
  end if;

  select * into v_existing
  from public.staff_payroll_monthly_v13
  where staff_username=p_staff_username and payroll_month=p_payroll_month
  for update;

  if found and coalesce(v_existing.status,'draft') in ('approved','paid') then
    return public.save_staff_payroll_monthly_v16(
      p_staff_username,p_payroll_month,
      coalesce(v_existing.worked_hours,0),coalesce(v_existing.overtime_hours,0),0,
      coalesce(v_existing.incentives_total,0),coalesce(v_existing.deductions_total,0),
      coalesce(v_existing.manual_adjustment,0),coalesce(v_existing.notes,p_notes),v_status
    );
  end if;

  v_components := public.get_payroll_components_v17(v_staff_id,to_char(p_payroll_month,'YYYY-MM'));
  v_base := coalesce((v_components->>'base_salary_component')::numeric,0);
  v_monthly := coalesce((v_components->>'monthly_incentive_component')::numeric,0);
  v_list := coalesce((v_components->>'list_incentive_component')::numeric,0);
  v_overtime_rate := coalesce((v_components->>'overtime_hour_rate')::numeric,0);
  v_overtime := round(coalesce(p_overtime_hours,0)*v_overtime_rate,2);
  v_total_deductions := round(
      greatest(coalesce(p_expiry_shortage_deduction,0),0)
    + greatest(coalesce(p_branch_general_deduction,0),0)
    + greatest(coalesce(p_individual_deduction,0),0)
    + greatest(coalesce(p_other_deduction,0),0)
  ,2);

  -- V16 is the atomic/freeze kernel and already adds the COMPLETE automated incentive truth,
  -- including the earned monthly performance incentive. Keep compatibility salary inputs zero.
  insert into public.staff_payroll_profiles_v13(
    staff_username,staff_name,role,branch,base_salary,hourly_rate,target_bonus_amount,quarterly_bonus_amount,active,notes,updated_at
  ) values (
    p_staff_username,v_staff_name,v_staff_role,v_branch,0,0,0,0,true,
    'Compatibility profile — salary calculated by payroll V17',now()
  )
  on conflict(staff_username) do update
    set staff_name=excluded.staff_name,
        role=excluded.role,
        branch=excluded.branch,
        base_salary=0,
        hourly_rate=0,
        target_bonus_amount=0,
        quarterly_bonus_amount=0,
        active=true,
        notes='Compatibility profile — salary calculated by payroll V17',
        updated_at=now();

  -- DO NOT add v_monthly here: V16 adds it from get_payroll_incentive_truth_v2.
  -- Bridge contains only components not already in V16 automated truth.
  v_bridge_adjustment := round(
      v_base + v_list + v_overtime + coalesce(p_manual_adjustment,0)
  ,2);

  v_saved := public.save_staff_payroll_monthly_v16(
    p_staff_username,p_payroll_month,
    coalesce(p_worked_hours,0),coalesce(p_overtime_hours,0),0,
    coalesce(p_manual_incentives,0),v_total_deductions,v_bridge_adjustment,p_notes,v_status
  );

  update public.staff_payroll_monthly_v13
  set salary_engine_version=17,
      base_salary_component=v_base,
      monthly_incentive_component=v_monthly,
      list_incentive_component=v_list,
      overtime_component=v_overtime,
      expiry_shortage_deduction=greatest(coalesce(p_expiry_shortage_deduction,0),0),
      branch_general_deduction=greatest(coalesce(p_branch_general_deduction,0),0),
      individual_deduction=greatest(coalesce(p_individual_deduction,0),0),
      other_deduction=greatest(coalesce(p_other_deduction,0),0),
      quarterly_bonus=0,
      incentives_total=coalesce(p_manual_incentives,0),
      deductions_total=v_total_deductions,
      manual_adjustment=coalesce(p_manual_adjustment,0)+coalesce(v_saved.post_paid_adjustments_total,0),
      approval_snapshot=case when v_saved.status='approved' then
        coalesce(v_saved.approval_snapshot,'{}'::jsonb) || jsonb_build_object(
          'engine_version',17,
          'salary_formula','canonical_compensation_v17_no_double_count',
          'quarterly_incentive_archived',true,
          'compensation_components',v_components,
          'payroll_components',jsonb_build_object(
            'base_salary',v_base,
            'monthly_incentive_earned',v_monthly,
            'monthly_incentive_cap',coalesce((v_components->>'monthly_incentive_cap')::numeric,0),
            'list_incentive',v_list,
            'overtime',v_overtime,
            'manual_incentives',coalesce(p_manual_incentives,0),
            'manual_adjustment_input',coalesce(p_manual_adjustment,0),
            'expiry_shortage_deduction',greatest(coalesce(p_expiry_shortage_deduction,0),0),
            'branch_general_deduction',greatest(coalesce(p_branch_general_deduction,0),0),
            'individual_deduction',greatest(coalesce(p_individual_deduction,0),0),
            'other_deduction',greatest(coalesce(p_other_deduction,0),0),
            'deductions_total',v_total_deductions,
            'post_paid_adjustments_total',coalesce(v_saved.post_paid_adjustments_total,0)
          )
        )
      else approval_snapshot end,
      freeze_version=case when v_saved.status='approved' then 17 else freeze_version end,
      updated_at=now()
  where id=v_saved.id
  returning * into v_saved;

  return v_saved;
end;
$function$;

revoke all on function public.get_payroll_components_v17(uuid,text) from public;
grant execute on function public.get_payroll_components_v17(uuid,text) to anon,authenticated,service_role;

revoke all on function public.save_staff_payroll_monthly_v17(text,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public;
grant execute on function public.save_staff_payroll_monthly_v17(text,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
