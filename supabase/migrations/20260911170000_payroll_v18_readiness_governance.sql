-- Payroll V18 readiness/governance.
-- Keeps V17 calculation/freeze semantics, but blocks NEW approval until the
-- canonical compensation profile is fully configured for the monthly-hour-unit model.

create or replace function public.dawaa_payroll_profile_readiness_v18(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_end_date date;
  v_start_date date;
  v_username text;
  v_name text;
  v_role text;
  v_branch text;
  v_account_branch text;
  v_profile public.employee_compensation_profiles%rowtype;
  v_profile_exists boolean := false;
  v_list_count integer := 0;
  v_missing text[] := array[]::text[];
  v_ready boolean := false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_readiness_input' using errcode='22023';
  end if;

  v_end_date := to_date(p_month_cycle || '-25','YYYY-MM-DD');
  v_start_date := ((v_end_date - interval '1 month')::date + 1);

  select sa.username,
         coalesce(sa.name,sa.staff_name,s.name,sa.username),
         coalesce(sa.role,s.role),
         coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),'')),
         nullif(trim(sa.branch),'')
  into v_username,v_name,v_role,v_branch,v_account_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select * into v_profile
  from public.employee_compensation_profiles p
  where p.staff_id=p_staff_id::text and coalesce(p.active,true)
  limit 1;
  v_profile_exists := found;

  if not v_profile_exists then
    v_missing := array_append(v_missing,'compensation_profile');
  else
    if coalesce(v_profile.salary_calculation_mode,'legacy_fixed') <> 'monthly_hour_unit' then
      v_missing := array_append(v_missing,'salary_calculation_mode');
    end if;
    if coalesce(v_profile.monthly_hour_unit_value,0) <= 0 then
      v_missing := array_append(v_missing,'monthly_hour_unit_value');
    end if;
    if coalesce(v_profile.contracted_daily_hours,0) <= 0 then
      v_missing := array_append(v_missing,'contracted_daily_hours');
    end if;
    if coalesce(trim(v_profile.branch),'') = '' then
      v_missing := array_append(v_missing,'profile_branch');
    elsif coalesce(trim(v_branch),'') <> '' and trim(v_profile.branch) <> trim(v_branch) then
      v_missing := array_append(v_missing,'profile_branch_mismatch');
    end if;
  end if;

  if coalesce(trim(v_branch),'')='' then
    v_missing := array_append(v_missing,'staff_branch');
  end if;

  select count(*)::integer into v_list_count
  from public.incentive_medicines im
  where coalesce(im.active,true)
    and coalesce(im.incentive_value,0) > 0
    and (im.effective_date is null or im.effective_date <= v_end_date)
    and (im.expiry_date is null or im.expiry_date >= v_start_date)
    and (
      coalesce(trim(im.branch),'') in ('','الكل','كل الفروع')
      or trim(im.branch)=trim(v_branch)
    );

  v_ready := coalesce(array_length(v_missing,1),0)=0;

  return jsonb_build_object(
    'engine_version',18,
    'staff_id',p_staff_id,
    'username',v_username,
    'staff_name',v_name,
    'role',v_role,
    'branch',v_branch,
    'account_branch',v_account_branch,
    'identity_branch_mismatch',coalesce(trim(v_branch),'')<>coalesce(trim(v_account_branch),''),
    'month_cycle',p_month_cycle,
    'cycle_start',v_start_date,
    'cycle_end',v_end_date,
    'profile_exists',v_profile_exists,
    'salary_calculation_mode',coalesce(v_profile.salary_calculation_mode,'legacy_fixed'),
    'monthly_hour_unit_value',coalesce(v_profile.monthly_hour_unit_value,0),
    'contracted_daily_hours',coalesce(v_profile.contracted_daily_hours,0),
    'calculated_base_salary',case when coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='monthly_hour_unit'
      then round(coalesce(v_profile.monthly_hour_unit_value,0)*coalesce(v_profile.contracted_daily_hours,0),2)
      else coalesce(v_profile.monthly_base_salary,0) end,
    'overtime_hour_rate',coalesce(v_profile.overtime_hour_rate,0),
    'monthly_incentive_cap',coalesce(v_profile.monthly_incentive_base,0),
    'active_list_items',v_list_count,
    'missing_fields',to_jsonb(v_missing),
    'ready_for_approval',v_ready
  );
end;
$$;

create or replace function public.get_payroll_configuration_readiness_v18(
  p_month_cycle text
)
returns table(
  staff_id uuid,
  username text,
  staff_name text,
  role text,
  branch text,
  salary_calculation_mode text,
  monthly_hour_unit_value numeric,
  contracted_daily_hours numeric,
  calculated_base_salary numeric,
  overtime_hour_rate numeric,
  monthly_incentive_cap numeric,
  active_list_items integer,
  ready_for_approval boolean,
  missing_fields jsonb
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  r record;
  j jsonb;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_readiness_input' using errcode='22023';
  end if;

  for r in
    select s.id,
           sa.username
    from public.staff s
    join public.staff_accounts sa on sa.staff_id=s.id::text
    where coalesce(s.active,true)
      and coalesce(s.is_active,true)
      and coalesce(sa.active,true)
      and coalesce(sa.can_login,true)
      and public.dawaa_can_manage_payroll_staff_v1(sa.username)
    order by s.name
  loop
    j := public.dawaa_payroll_profile_readiness_v18(r.id,p_month_cycle);
    staff_id := r.id;
    username := j->>'username';
    staff_name := j->>'staff_name';
    role := j->>'role';
    branch := j->>'branch';
    salary_calculation_mode := j->>'salary_calculation_mode';
    monthly_hour_unit_value := coalesce((j->>'monthly_hour_unit_value')::numeric,0);
    contracted_daily_hours := coalesce((j->>'contracted_daily_hours')::numeric,0);
    calculated_base_salary := coalesce((j->>'calculated_base_salary')::numeric,0);
    overtime_hour_rate := coalesce((j->>'overtime_hour_rate')::numeric,0);
    monthly_incentive_cap := coalesce((j->>'monthly_incentive_cap')::numeric,0);
    active_list_items := coalesce((j->>'active_list_items')::integer,0);
    ready_for_approval := coalesce((j->>'ready_for_approval')::boolean,false);
    missing_fields := coalesce(j->'missing_fields','[]'::jsonb);
    return next;
  end loop;
end;
$$;

create or replace function public.dawaa_assert_payroll_profile_ready_v18(
  p_staff_id uuid,
  p_month_cycle text
)
returns void
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  j jsonb;
begin
  j := public.dawaa_payroll_profile_readiness_v18(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready_for_approval')::boolean,false) is not true then
    raise exception 'payroll_profile_not_ready_for_approval: %', coalesce(j->'missing_fields','[]'::jsonb)::text
      using errcode='22023';
  end if;
end;
$$;

-- Re-issue V17 save command with one governance addition: NEW approvals/payments
-- must pass V18 profile readiness. Existing approved/paid snapshots remain immutable
-- and can still progress from approved -> paid without reinterpreting historical salary.
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

  select s.id,
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

  if v_status in ('approved','paid') then
    perform public.dawaa_assert_payroll_profile_ready_v18(v_staff_id,to_char(p_payroll_month,'YYYY-MM'));
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

  v_bridge_adjustment := round(v_base + v_list + v_overtime + coalesce(p_manual_adjustment,0),2);

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
          'engine_version',18,
          'salary_formula','canonical_compensation_v18_readiness_guard',
          'quarterly_incentive_archived',true,
          'configuration_readiness',public.dawaa_payroll_profile_readiness_v18(v_staff_id,to_char(p_payroll_month,'YYYY-MM')),
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
      freeze_version=case when v_saved.status='approved' then 18 else freeze_version end,
      updated_at=now()
  where id=v_saved.id
  returning * into v_saved;

  return v_saved;
end;
$$;

revoke all on function public.dawaa_payroll_profile_readiness_v18(uuid,text) from public;
revoke all on function public.get_payroll_configuration_readiness_v18(text) from public;
revoke all on function public.dawaa_assert_payroll_profile_ready_v18(uuid,text) from public;
grant execute on function public.dawaa_payroll_profile_readiness_v18(uuid,text) to anon,authenticated,service_role;
grant execute on function public.get_payroll_configuration_readiness_v18(text) to anon,authenticated,service_role;
grant execute on function public.dawaa_assert_payroll_profile_ready_v18(uuid,text) to service_role;
