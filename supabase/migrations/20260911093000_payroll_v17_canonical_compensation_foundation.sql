-- Payroll V17 foundation: one compensation master, explicit salary formula, detailed components.
-- Canonical master profile: employee_compensation_profiles.
-- staff_payroll_profiles_v13 remains compatibility-only during the migration.

alter table public.employee_compensation_profiles
  add column if not exists salary_calculation_mode text not null default 'legacy_fixed',
  add column if not exists monthly_hour_unit_value numeric not null default 0,
  add column if not exists contracted_daily_hours numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.employee_compensation_profiles'::regclass
      and conname='employee_compensation_profiles_salary_mode_v17_check'
  ) then
    alter table public.employee_compensation_profiles
      add constraint employee_compensation_profiles_salary_mode_v17_check
      check (salary_calculation_mode in ('legacy_fixed','monthly_hour_unit'));
  end if;
end $$;

comment on column public.employee_compensation_profiles.monthly_hour_unit_value is
  'قيمة شهرية لكل ساعة دوام يومية متعاقد عليها. مثال 800 × 8 ساعات يومية = 6400 راتب أساسي للدورة.';
comment on column public.employee_compensation_profiles.contracted_daily_hours is
  'عدد ساعات الدوام اليومية المتعاقد عليها؛ لا تمثل ساعات البصمة الفعلية.';
comment on column public.employee_compensation_profiles.salary_calculation_mode is
  'legacy_fixed يحافظ على monthly_base_salary الحالي؛ monthly_hour_unit يحسب الأساسي = monthly_hour_unit_value × contracted_daily_hours.';

alter table public.staff_payroll_monthly_v13
  add column if not exists salary_engine_version integer,
  add column if not exists base_salary_component numeric not null default 0,
  add column if not exists monthly_incentive_component numeric not null default 0,
  add column if not exists list_incentive_component numeric not null default 0,
  add column if not exists overtime_component numeric not null default 0,
  add column if not exists expiry_shortage_deduction numeric not null default 0,
  add column if not exists branch_general_deduction numeric not null default 0,
  add column if not exists individual_deduction numeric not null default 0,
  add column if not exists other_deduction numeric not null default 0;

create or replace function public.get_payroll_components_v17(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_username text;
  v_staff_name text;
  v_branch text;
  v_profile public.employee_compensation_profiles%rowtype;
  v_truth record;
  v_base numeric := 0;
  v_monthly numeric := 0;
  v_list numeric := 0;
  v_list_items jsonb := '[]'::jsonb;
  v_target numeric := 0;
  v_performance numeric := 0;
  v_automated numeric := 0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_components_input' using errcode='22023';
  end if;

  select sa.username, coalesce(sa.name,sa.staff_name,s.name,sa.username), coalesce(sa.branch,s.branch)
    into v_username,v_staff_name,v_branch
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
    v_monthly := coalesce(v_profile.monthly_incentive_base,0);
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
    select ims.medicine_id, max(ims.product_name) product_name,
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
  v_automated := coalesce(v_truth.automated_incentives_total_egp,0);

  return jsonb_build_object(
    'engine_version',17,
    'staff_id',p_staff_id,
    'staff_username',v_username,
    'staff_name',v_staff_name,
    'branch',v_branch,
    'month_cycle',p_month_cycle,
    'salary_calculation_mode',coalesce(v_profile.salary_calculation_mode,'legacy_fixed'),
    'monthly_hour_unit_value',coalesce(v_profile.monthly_hour_unit_value,0),
    'contracted_daily_hours',coalesce(v_profile.contracted_daily_hours,0),
    'base_salary_component',v_base,
    'monthly_incentive_component',v_monthly,
    'overtime_hour_rate',coalesce(v_profile.overtime_hour_rate,0),
    'list_incentive_component',v_list,
    'list_items',v_list_items,
    'target_bonus_component',v_target,
    'performance_incentive_component',v_performance,
    'automated_incentives_total',v_automated,
    'quarterly_incentive_archived',true
  );
end;
$$;

revoke all on function public.get_payroll_components_v17(uuid,text) from public;
grant execute on function public.get_payroll_components_v17(uuid,text) to anon, authenticated, service_role;

notify pgrst,'reload schema';
