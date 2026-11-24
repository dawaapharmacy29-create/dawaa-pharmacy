-- Owner report 2026-11-24: the list incentive in payroll was always empty although the list items were really sold.
-- get_payroll_components_v17 summed incentive_medicine_sales, which nothing filled (0 rows ever). The list incentive
-- now comes straight from the eligible invoice lines of the cycle (get_list_incentive_invoice_lines_v1, the same lines
-- the list page shows), plus any manual rows still kept in incentive_medicine_sales. A finalized payroll keeps the
-- components frozen in its snapshot, so this only changes open cycles.
-- Items sold from the other branch's catalog (a doctor covering a shift there) are kept too (full join on the catalog).

create or replace function public.get_payroll_components_v17(p_staff_id uuid, p_month_cycle text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_username text;
  v_staff_name text;
  v_branch text;
  v_account_branch text;
  v_profile public.employee_compensation_profiles%rowtype;
  v_truth record;
  v_base numeric := 0;
  v_hours_calc jsonb;
  v_monthly numeric := 0;
  v_monthly_cap numeric := 0;
  v_list numeric := 0;
  v_list_items jsonb := '[]'::jsonb;
  v_target numeric := 0;
  v_performance numeric := 0;
  v_automated numeric := 0;
  v_other_automated numeric := 0;
  v_start date;
  v_end date;
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
    if coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='attendance_hours_v1' then
      v_hours_calc := public.attendance_hours_based_salary_v1(p_staff_id, p_month_cycle);
      v_base := coalesce((v_hours_calc->>'base_salary_computed')::numeric, 0);
    elsif coalesce(v_profile.salary_calculation_mode,'legacy_fixed')='monthly_hour_unit' then
      v_base := round(coalesce(v_profile.monthly_hour_unit_value,0)*coalesce(v_profile.contracted_daily_hours,0),2);
    else
      v_base := coalesce(v_profile.monthly_base_salary,0);
    end if;
    v_monthly_cap := coalesce(v_profile.monthly_incentive_base,0);
  end if;

  select cycle_start, cycle_end into v_start, v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle || '-25', 'YYYY-MM-DD'));

  with catalog as (
    select * from public.get_payroll_incentive_catalog_v18(p_month_cycle,v_branch)
  ), sold as (
    -- manual rows (anything not generated from the invoice lines)
    select ims.medicine_id, coalesce(ims.quantity,0) as quantity, coalesce(ims.incentive_total,0) as incentive_total
    from public.incentive_medicine_sales ims
    where coalesce(ims.staff_id::text,nullif(ims.doctor_id,''))=p_staff_id::text
      and ims.month_cycle=p_month_cycle
      and coalesce(ims.source_type,'') <> 'invoice_lines_v1'
    union all
    -- the eligible list lines this employee sold in the cycle
    select l.medicine_id::uuid, l.units, l.units * l.rate
    from public.get_list_incentive_invoice_lines_v1(v_start, v_end, null) l
    where l.seller_id = p_staff_id::text and l.kind = 'list' and l.attribution = 'eligible'
      and l.medicine_id ~* '^[0-9a-f-]{36}$'
  ), sales as (
    select medicine_id, sum(quantity) as quantity, sum(incentive_total) as incentive_total
    from sold group by medicine_id
  ), rows as (
    select coalesce(c.medicine_id, s.medicine_id) as medicine_id,
           coalesce(c.product_name, m.product_name, 'صنف لستة') as product_name,
           coalesce(s.quantity,0) as quantity,
           coalesce(c.incentive_per_unit, m.incentive_value, case when s.quantity > 0 then round(s.incentive_total / s.quantity, 2) end, 0) as incentive_per_unit,
           round(coalesce(s.incentive_total,0),2) as incentive_total
    from catalog c
    full join sales s on s.medicine_id=c.medicine_id
    left join public.incentive_medicines m on m.id = s.medicine_id
  )
  select coalesce(sum(r.incentive_total),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'medicine_id',r.medicine_id,
           'product_name',r.product_name,
           'quantity',r.quantity,
           'incentive_per_unit',r.incentive_per_unit,
           'incentive_total',r.incentive_total
         ) order by r.incentive_total desc, r.product_name),'[]'::jsonb)
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
    'attendance_hours_breakdown', v_hours_calc,
    'base_salary_component',v_base,
    'monthly_incentive_cap',v_monthly_cap,
    'monthly_incentive_component',v_monthly,
    'overtime_hour_rate',coalesce(v_profile.overtime_hour_rate,0),
    'list_incentive_component',v_list,
    'list_items',v_list_items,
    'list_item_count',jsonb_array_length(v_list_items),
    'list_incentive_source','invoice_lines_v1',
    'target_bonus_component',v_target,
    'performance_incentive_component',v_performance,
    'automated_incentives_total',v_automated,
    'other_automated_incentives_total',v_other_automated,
    'quarterly_incentive_archived',true
  );
end;
$function$;

-- The payslip's list table reads the same live lines.
create or replace function public.get_evaluation_cycle_approval_v1(p_staff_id uuid, p_month_cycle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row public.evaluation_cycle_approvals_v1%rowtype;
  v_list jsonb;
  v_start date;
  v_end date;
begin
  if not (public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id)
          or public.dawaa_current_attendance_subject_id() = p_staff_id) then
    raise exception 'not_authorized_for_evaluation_approval' using errcode = '42501';
  end if;
  select * into v_row from public.evaluation_cycle_approvals_v1 a where a.staff_id = p_staff_id and a.month_cycle = p_month_cycle;
  select cycle_start, cycle_end into v_start, v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle || '-25', 'YYYY-MM-DD'));
  select coalesce(jsonb_agg(jsonb_build_object('product_name', x.product_name, 'quantity', x.quantity,
           'incentive_per_unit', x.rate, 'incentive_total', x.total) order by x.total desc), '[]'::jsonb)
    into v_list
  from (
    select coalesce(m.product_name, l.product_code) as product_name, round(sum(l.units), 2) as quantity,
           max(l.rate) as rate, round(sum(l.units * l.rate), 2) as total
    from public.get_list_incentive_invoice_lines_v1(v_start, v_end, null) l
    left join public.incentive_medicines m on m.id::text = l.medicine_id
    where l.seller_id = p_staff_id::text and l.kind = 'list' and l.attribution = 'eligible'
    group by 1
  ) x;
  return jsonb_build_object('approved', v_row.id is not null, 'approval', case when v_row.id is null then null else to_jsonb(v_row) end,
                            'list_items', v_list);
end;
$function$;

-- Approval no longer copies the lines into incentive_medicine_sales (payroll reads them live); drop the copies made so far.
delete from public.incentive_medicine_sales where source_type = 'invoice_lines_v1';

-- Kept for approve_evaluation_cycle_v1: it now only reports how many eligible list lines the cycle has.
create or replace function public.refresh_list_incentive_sales_v1(p_month_cycle text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_start date;
  v_end date;
  v_rows integer := 0;
begin
  if coalesce(trim(p_month_cycle), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_list_incentive_refresh' using errcode = '42501';
  end if;
  select cycle_start, cycle_end into v_start, v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle || '-25', 'YYYY-MM-DD'));
  select count(*) into v_rows from public.get_list_incentive_invoice_lines_v1(v_start, v_end, null) l
  where l.kind = 'list' and l.attribution = 'eligible';
  return v_rows;
end;
$function$;
