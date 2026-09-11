-- Payroll V18 list projection.
-- The incentive list is a product catalog for the branch/cycle, not a product assigned
-- to one doctor. Every pharmacist can therefore show quantity sold for every active
-- list item, including zero-sale items.

alter table public.incentive_medicine_sales
  add column if not exists staff_id uuid,
  add column if not exists source_type text,
  add column if not exists source_ref text,
  add column if not exists invoice_no text;

update public.incentive_medicine_sales
set staff_id = doctor_id::uuid
where staff_id is null
  and coalesce(doctor_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

create index if not exists incentive_medicine_sales_staff_cycle_idx
  on public.incentive_medicine_sales(staff_id,month_cycle);

create unique index if not exists incentive_medicine_sales_source_dedupe_v18_idx
  on public.incentive_medicine_sales(medicine_id,staff_id,branch,sale_date,source_type,source_ref)
  where source_ref is not null and staff_id is not null;

create or replace function public.get_payroll_incentive_catalog_v18(
  p_month_cycle text,
  p_branch text
)
returns table(
  medicine_id uuid,
  product_name text,
  branch text,
  incentive_per_unit numeric,
  effective_date date,
  expiry_date date
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_end_date date;
  v_start_date date;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_list_cycle' using errcode='22023';
  end if;
  v_end_date := to_date(p_month_cycle || '-25','YYYY-MM-DD');
  v_start_date := ((v_end_date - interval '1 month')::date + 1);

  return query
  select im.id,
         im.product_name,
         im.branch,
         round(case
           when lower(coalesce(im.incentive_type,'fixed'))='percent'
             then coalesce(im.product_price,im.unit_price,0) * coalesce(im.incentive_percent,0) / 100
           else coalesce(im.incentive_value,0)
         end,2) as incentive_per_unit,
         im.effective_date,
         im.expiry_date
  from public.incentive_medicines im
  where coalesce(im.active,true)
    and (im.effective_date is null or im.effective_date <= v_end_date)
    and (im.expiry_date is null or im.expiry_date >= v_start_date)
    and (
      coalesce(trim(im.branch),'') in ('','الكل','كل الفروع')
      or trim(im.branch)=trim(coalesce(p_branch,''))
    )
    and (case
      when lower(coalesce(im.incentive_type,'fixed'))='percent'
        then coalesce(im.product_price,im.unit_price,0) * coalesce(im.incentive_percent,0) / 100
      else coalesce(im.incentive_value,0)
    end) > 0
  order by im.product_name;
end;
$$;

-- Rebuild payroll components so the list shows the complete configured catalog,
-- including products with quantity 0 for the selected employee.
create or replace function public.get_payroll_components_v17(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
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

  select sa.username,
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

  with catalog as (
    select * from public.get_payroll_incentive_catalog_v18(p_month_cycle,v_branch)
  ), sales as (
    select ims.medicine_id,
           sum(coalesce(ims.quantity,0)) as quantity,
           sum(coalesce(ims.incentive_total,0)) as incentive_total
    from public.incentive_medicine_sales ims
    where coalesce(ims.staff_id::text,nullif(ims.doctor_id,''))=p_staff_id::text
      and ims.month_cycle=p_month_cycle
    group by ims.medicine_id
  ), rows as (
    select c.medicine_id,
           c.product_name,
           coalesce(s.quantity,0) as quantity,
           c.incentive_per_unit,
           round(coalesce(s.incentive_total,0),2) as incentive_total
    from catalog c
    left join sales s on s.medicine_id=c.medicine_id
  )
  select coalesce(sum(r.incentive_total),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'medicine_id',r.medicine_id,
           'product_name',r.product_name,
           'quantity',r.quantity,
           'incentive_per_unit',r.incentive_per_unit,
           'incentive_total',r.incentive_total
         ) order by r.product_name),'[]'::jsonb)
  into v_list,v_list_items
  from rows r;

  select * into v_truth
  from public.get_payroll_incentive_truth_v2(p_staff_id,p_month_cycle)
  limit 1;

  v_target := coalesce(v_truth.target_bonus_egp,0);
  v_performance := coalesce(v_truth.performance_incentive_egp,0);
  v_monthly := v_performance;
  v_automated := coalesce(v_truth.automated_incentives_total_egp,0);
  v_other_automated := v_automated - v_performance;

  return jsonb_build_object(
    'engine_version',18,
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
    'list_item_count',jsonb_array_length(v_list_items),
    'target_bonus_component',v_target,
    'performance_incentive_component',v_performance,
    'automated_incentives_total',v_automated,
    'other_automated_incentives_total',v_other_automated,
    'quarterly_incentive_archived',true
  );
end;
$$;

-- Readiness now counts the same canonical list catalog used by payroll.
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
  from public.get_payroll_incentive_catalog_v18(p_month_cycle,v_branch);

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

revoke all on function public.get_payroll_incentive_catalog_v18(text,text) from public;
grant execute on function public.get_payroll_incentive_catalog_v18(text,text) to anon,authenticated,service_role;
