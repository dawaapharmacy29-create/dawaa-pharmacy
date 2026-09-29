create or replace function public.attendance_payroll_engine_v2(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_start date; v_end date; v_month text;
  v_comp public.employee_compensation_profiles%rowtype;
  v_username text;
  v_actual_days integer:=0; v_actual_hours numeric:=0; v_base_hours numeric:=0;
  v_absence_days integer:=0; v_off_days integer:=0; v_timeoff_days integer:=0; v_pending_days integer:=0; v_worked_on_off integer:=0;
  v_approved_ot_hours numeric:=0; v_approved_ot_amount numeric:=0; v_pending_ot_hours numeric:=0;
  v_true_hourly_rate numeric:=0; v_base_salary numeric:=0; v_cycle_closed boolean:=false; v_eligibility jsonb;
begin
  if p_staff_id is null then raise exception 'payroll_staff_required' using errcode='22023'; end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text or sa.id=p_staff_id
  order by (sa.staff_id=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;
  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  if p_month_cycle is not null then
    select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
    v_month:=p_month_cycle;
  else
    select cycle_start,cycle_end,month_cycle into v_start,v_end,v_month from public.dawaa_pay_cycle_bounds_v1(null);
  end if;

  select * into v_comp
  from public.employee_compensation_profiles p
  where p.staff_id=p_staff_id::text and coalesce(p.active,true) and (p.effective_from is null or p.effective_from<=v_end)
  order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last limit 1;

  if not found or coalesce(v_comp.hourly_rate,0)<=0 then
    return jsonb_build_object('ready',false,'reason','no_hourly_rate_configured','staff_id',p_staff_id,'month_cycle',v_month,'cycle_start',v_start,'cycle_end',v_end);
  end if;

  with approved as (
    select a.*,
      case when a.scheduled_start_at is not null and a.scheduled_end_at is not null
        then greatest(extract(epoch from(a.scheduled_end_at-a.scheduled_start_at))/3600.0,0) else null end as scheduled_hours
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id and a.attendance_date between v_start and least(v_end,(now() at time zone 'Africa/Cairo')::date) and a.status='approved'
  )
  select
    count(*) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','absence_review'))::integer,
    round(coalesce(sum(candidate_hours) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','absence_review')),0),2),
    round(coalesce(sum(case
      when coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','absence_review')
        then case when scheduled_hours is null or scheduled_hours<=0 then coalesce(candidate_hours,0) else least(coalesce(candidate_hours,0),scheduled_hours) end
      else 0 end),0),2),
    count(*) filter(where resolution_status='absence_review')::integer,
    count(*) filter(where resolution_status='off_day')::integer,
    count(*) filter(where resolution_status='approved_time_off')::integer,
    count(*) filter(where resolution_status='worked_on_off' and coalesce(candidate_hours,0)>0)::integer
  into v_actual_days,v_actual_hours,v_base_hours,v_absence_days,v_off_days,v_timeoff_days,v_worked_on_off
  from approved;

  select count(*)::integer into v_pending_days
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date between v_start and least(v_end,(now() at time zone 'Africa/Cairo')::date) and a.status='pending_review';

  select
    round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2),
    round(coalesce(sum(case when o.status='approved' then coalesce(o.overtime_amount,
      coalesce(o.overtime_hours,0)*coalesce(nullif(v_comp.overtime_hour_rate,0),v_comp.hourly_rate/26.0)) else 0 end),0),2),
    round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2)
  into v_approved_ot_hours,v_approved_ot_amount,v_pending_ot_hours
  from public.staff_overtime_approvals o
  where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end;

  v_true_hourly_rate:=round(v_comp.hourly_rate/26.0,4);
  v_base_salary:=round(v_base_hours*v_true_hourly_rate,2);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);

  begin
    v_eligibility:=public.get_payroll_attendance_eligibility_v1(p_staff_id,v_month);
  exception when others then
    v_eligibility:=jsonb_build_object('ready_for_payroll',false,'status','eligibility_unavailable');
  end;

  return jsonb_build_object(
    'ready',true,'engine_version',2,'staff_id',p_staff_id,'month_cycle',v_month,'cycle_start',v_start,'cycle_end',v_end,'cycle_closed',v_cycle_closed,
    'salary_calculation_mode',coalesce(v_comp.salary_calculation_mode,'legacy_fixed'),'monthly_reference_rate',v_comp.hourly_rate,'true_hourly_rate',v_true_hourly_rate,
    'actual_worked_days',v_actual_days,'actual_worked_hours',v_actual_hours,'base_payable_hours',v_base_hours,'base_salary_computed',v_base_salary,
    'approved_overtime_hours',v_approved_ot_hours,'approved_overtime_amount',v_approved_ot_amount,'pending_overtime_hours',v_pending_ot_hours,
    'absence_days',v_absence_days,'off_days',v_off_days,'approved_time_off_days',v_timeoff_days,'worked_on_off_days',v_worked_on_off,
    'pending_review_days',v_pending_days,'attendance_eligibility',v_eligibility,
    'ready_for_final',v_cycle_closed and v_pending_days=0 and v_pending_ot_hours=0 and coalesce((v_eligibility->>'ready_for_payroll')::boolean,false),
    'rule','base hours = actual approved hours capped at scheduled hours; approved overtime is separate'
  );
end;
$$;

revoke all on function public.attendance_payroll_engine_v2(uuid,text) from public,anon;
grant execute on function public.attendance_payroll_engine_v2(uuid,text) to authenticated,service_role;

create or replace function public.attendance_hours_based_salary_v1(p_staff_id uuid,p_month_cycle text default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
declare j jsonb;
begin
  j:=public.attendance_payroll_engine_v2(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready')::boolean,false) is not true then return j; end if;
  return j || jsonb_build_object(
    'evaluated_approved_days',coalesce((j->>'actual_worked_days')::integer,0)+coalesce((j->>'absence_days')::integer,0)+coalesce((j->>'off_days')::integer,0)+coalesce((j->>'approved_time_off_days')::integer,0),
    'gross_worked_hours',coalesce((j->>'actual_worked_hours')::numeric,0),'late_minutes_total',0,'deduction_minutes_after_netting',0,'early_leave_minutes_total',0,
    'net_hours',coalesce((j->>'base_payable_hours')::numeric,0),'absence_days',coalesce((j->>'absence_days')::integer,0),
    'base_salary_computed',coalesce((j->>'base_salary_computed')::numeric,0),
    'calculation_note','No double deduction: missing hours are already absent from actual worked time; overtime is separate.'
  );
end;
$$;

create or replace function public.dawaa_payroll_profile_readiness_v18(p_staff_id uuid,p_month_cycle text)
returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
declare
  v_end_date date; v_start_date date; v_username text; v_name text; v_role text; v_branch text; v_account_branch text;
  v_profile public.employee_compensation_profiles%rowtype; v_profile_exists boolean:=false; v_list_count integer:=0;
  v_missing text[]:=array[]::text[]; v_ready boolean:=false; v_engine jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then raise exception 'invalid_payroll_readiness_input' using errcode='22023'; end if;
  v_end_date:=to_date(p_month_cycle||'-25','YYYY-MM-DD'); v_start_date:=((v_end_date-interval '1 month')::date+1);

  select sa.username,coalesce(sa.name,sa.staff_name,s.name,sa.username),coalesce(sa.role,s.role),
    coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),'')),nullif(trim(sa.branch),'')
  into v_username,v_name,v_role,v_branch,v_account_branch
  from public.staff_accounts sa left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text order by coalesce(sa.active,true) desc,sa.created_at desc nulls last limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then raise exception 'not_authorized_for_payroll_staff' using errcode='42501'; end if;

  select * into v_profile from public.employee_compensation_profiles p
  where p.staff_id=p_staff_id::text and coalesce(p.active,true) and (p.effective_from is null or p.effective_from<=v_end_date)
  order by p.effective_from desc nulls last,p.updated_at desc nulls last limit 1;
  v_profile_exists:=found;

  if not v_profile_exists then v_missing:=array_append(v_missing,'compensation_profile');
  else
    if coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='attendance_hours_v1' then
      if coalesce(v_profile.hourly_rate,0)<=0 then v_missing:=array_append(v_missing,'hourly_rate'); end if;
    elsif coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='monthly_hour_unit' then
      if coalesce(v_profile.monthly_hour_unit_value,0)<=0 then v_missing:=array_append(v_missing,'monthly_hour_unit_value'); end if;
      if coalesce(v_profile.contracted_daily_hours,0)<=0 then v_missing:=array_append(v_missing,'contracted_daily_hours'); end if;
    else v_missing:=array_append(v_missing,'salary_calculation_mode'); end if;

    if coalesce(trim(v_profile.branch),'')='' then v_missing:=array_append(v_missing,'profile_branch');
    elsif coalesce(trim(v_branch),'')<>'' and trim(v_profile.branch)<>trim(v_branch) then v_missing:=array_append(v_missing,'profile_branch_mismatch'); end if;
  end if;

  if coalesce(trim(v_branch),'')='' then v_missing:=array_append(v_missing,'staff_branch'); end if;
  select count(*)::integer into v_list_count from public.get_payroll_incentive_catalog_v18(p_month_cycle,v_branch);

  if v_profile_exists and coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='attendance_hours_v1' then
    begin
      v_engine:=public.attendance_payroll_engine_v2(p_staff_id,p_month_cycle);
      if coalesce((v_engine->>'pending_review_days')::integer,0)>0 then v_missing:=array_append(v_missing,'attendance_pending_review'); end if;
      if coalesce((v_engine->>'pending_overtime_hours')::numeric,0)>0 then v_missing:=array_append(v_missing,'overtime_pending_approval'); end if;
    exception when others then v_missing:=array_append(v_missing,'attendance_engine_unavailable'); end;
  end if;

  v_ready:=coalesce(array_length(v_missing,1),0)=0;

  return jsonb_build_object(
    'engine_version',19,'staff_id',p_staff_id,'username',v_username,'staff_name',v_name,'role',v_role,'branch',v_branch,'account_branch',v_account_branch,
    'identity_branch_mismatch',coalesce(trim(v_branch),'')<>coalesce(trim(v_account_branch),''),
    'month_cycle',p_month_cycle,'cycle_start',v_start_date,'cycle_end',v_end_date,'profile_exists',v_profile_exists,
    'salary_calculation_mode',coalesce(v_profile.salary_calculation_mode,'legacy_fixed'),'hourly_rate',coalesce(v_profile.hourly_rate,0),
    'monthly_hour_unit_value',coalesce(v_profile.monthly_hour_unit_value,0),'contracted_daily_hours',coalesce(v_profile.contracted_daily_hours,0),
    'calculated_base_salary',case
      when coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='attendance_hours_v1' then coalesce((v_engine->>'base_salary_computed')::numeric,0)
      when coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='monthly_hour_unit' then round(coalesce(v_profile.monthly_hour_unit_value,0)*coalesce(v_profile.contracted_daily_hours,0),2)
      else coalesce(v_profile.monthly_base_salary,0) end,
    'attendance_engine',v_engine,'overtime_hour_rate',coalesce(v_profile.overtime_hour_rate,0),'monthly_incentive_cap',coalesce(v_profile.monthly_incentive_base,0),
    'active_list_items',v_list_count,'missing_fields',to_jsonb(v_missing),'ready_for_approval',v_ready
  );
end;
$$;
