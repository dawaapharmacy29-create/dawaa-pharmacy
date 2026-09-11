-- Payroll V17 write command. Uses canonical compensation profile while preserving V16 atomic settlement/freeze behavior.

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
) returns public.staff_payroll_monthly_v13
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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

  select s.id,coalesce(sa.name,sa.staff_name,s.name,sa.username),coalesce(sa.role,s.role),coalesce(sa.branch,s.branch)
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

  insert into public.staff_payroll_profiles_v13(
    staff_username,staff_name,role,branch,base_salary,hourly_rate,target_bonus_amount,quarterly_bonus_amount,active,notes,updated_at
  ) values (
    p_staff_username,v_staff_name,v_staff_role,v_branch,0,0,0,0,true,'Compatibility profile — salary calculated by payroll V17',now()
  )
  on conflict(staff_username) do update
    set staff_name=excluded.staff_name,role=excluded.role,branch=excluded.branch,
        base_salary=0,hourly_rate=0,quarterly_bonus_amount=0,active=true,
        notes='Compatibility profile — salary calculated by payroll V17',updated_at=now();

  v_bridge_adjustment := round(
      v_base + v_monthly + v_list + v_overtime + coalesce(p_manual_adjustment,0)
  ,2);

  v_saved := public.save_staff_payroll_monthly_v16(
    p_staff_username,p_payroll_month,coalesce(p_worked_hours,0),coalesce(p_overtime_hours,0),0,
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
          'salary_formula','canonical_compensation_v17',
          'quarterly_incentive_archived',true,
          'compensation_components',v_components,
          'payroll_components',jsonb_build_object(
            'base_salary',v_base,
            'monthly_incentive',v_monthly,
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
$$;

revoke all on function public.save_staff_payroll_monthly_v17(text,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v17(text,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
