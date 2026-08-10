-- Separate target-achievement bonus. It never replaces or alters the performance incentive.
-- Cycle boundaries are explicit (Dawaa cycle 26 -> 25) so old settlements stay reproducible.

create or replace function public.settle_target_achievement_bonus(
  p_cycle_start date,
  p_cycle_end date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_cycle_label text;
  v_row record;
  v_amount numeric;
  v_achievement numeric;
  v_existing_id uuid;
begin
  if p_cycle_start is null or p_cycle_end is null
     or p_cycle_end < p_cycle_start
     or extract(day from p_cycle_start) <> 26
     or extract(day from p_cycle_end) <> 25 then
    raise exception 'target bonus cycle must run from day 26 to day 25';
  end if;

  v_cycle_label := to_char(p_cycle_start, 'YYYY-MM');

  for v_row in
    with branch_performance as (
      select
        replace(replace(coalesce(t.branch_name, ''), 'فرع ', ''), 'فرع', '') as branch_key,
        max(t.target_amount)::numeric as target_amount,
        coalesce(sum(coalesce(i.net_amount, i.net_total, i.discounted_amount, i.total_amount, i.amount, 0)), 0)::numeric as sales_amount
      from public.branch_sales_targets t
      left join public.sales_invoices i
        on replace(replace(coalesce(i.branch, i.branch_name, ''), 'فرع ', ''), 'فرع', '')
           = replace(replace(coalesce(t.branch_name, ''), 'فرع ', ''), 'فرع', '')
       and i.invoice_date::date between p_cycle_start and p_cycle_end
      where t.active is true and t.target_amount > 0
      group by 1
    ), total_performance as (
      select sum(target_amount) target_amount, sum(sales_amount) sales_amount
      from branch_performance
    ), eligible_staff as (
      select
        s.id staff_id,
        s.name staff_name,
        s.branch,
        s.role,
        case
          when lower(coalesce(s.role, '')) in ('branches_manager', 'مدير الفروع', 'مديرة الفروع') then 'branches_manager'
          when lower(coalesce(s.role, '')) in ('branch_manager', 'مدير فرع', 'مديرة فرع') then 'branch_manager'
          when lower(coalesce(s.role, '')) in ('صيدلاني', 'صيدلي', 'pharmacist', 'doctor', 'دكتور') then 'doctor'
          else null
        end bonus_role
      from public.staff s
      where coalesce(s.active, s.is_active, true)
    )
    select
      e.*,
      case when e.bonus_role = 'branches_manager' then tp.target_amount else bp.target_amount end target_amount,
      case when e.bonus_role = 'branches_manager' then tp.sales_amount else bp.sales_amount end sales_amount
    from eligible_staff e
    left join branch_performance bp
      on replace(replace(coalesce(e.branch, ''), 'فرع ', ''), 'فرع', '') = bp.branch_key
    cross join total_performance tp
    where e.bonus_role is not null
  loop
    if coalesce(v_row.target_amount, 0) <= 0 then
      continue;
    end if;

    v_achievement := round(v_row.sales_amount / v_row.target_amount * 100, 1);
    v_amount := case
      when v_row.bonus_role = 'doctor' and v_achievement >= 100 then 600
      when v_row.bonus_role = 'doctor' and v_achievement >= 90 then 450
      when v_row.bonus_role = 'doctor' then 0
      when v_achievement >= 100 then 1000
      when v_achievement >= 90 then 750
      else 0
    end;

    select id into v_existing_id
    from public.employee_transactions
    where staff_id = v_row.staff_id
      and source = 'target_achievement_settlement'
      and month_cycle = v_cycle_label
    limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions(
        staff_id, type, title, reason, amount, points, points_delta, source,
        transaction_date, month_cycle, branch, status, employee_name,
        created_by, description, category, employee_visible, metadata
      ) values (
        v_row.staff_id, 'reward', 'حافز تحقيق التارجت', 'حافز تارجت مستقل عن حافز الأداء',
        v_amount, 0, 0, 'target_achievement_settlement', p_cycle_end, v_cycle_label,
        v_row.branch, 'active', v_row.staff_name, 'system_automation',
        'تحقيق ' || v_achievement || '% من التارجت — حافز ' || v_amount || ' جنيه',
        'target_bonus', true,
        jsonb_build_object(
          'engine_version', 1, 'bonus_role', v_row.bonus_role,
          'cycle_start', p_cycle_start, 'cycle_end', p_cycle_end,
          'sales_amount', v_row.sales_amount, 'target_amount', v_row.target_amount,
          'achievement_percent', v_achievement, 'target_bonus_egp', v_amount,
          'separate_from_performance_incentive', true
        )
      );
    else
      update public.employee_transactions
      set amount = v_amount,
          transaction_date = p_cycle_end,
          updated_at = now(),
          description = 'تحقيق ' || v_achievement || '% من التارجت — حافز ' || v_amount || ' جنيه',
          metadata = jsonb_build_object(
            'engine_version', 1, 'bonus_role', v_row.bonus_role,
            'cycle_start', p_cycle_start, 'cycle_end', p_cycle_end,
            'sales_amount', v_row.sales_amount, 'target_amount', v_row.target_amount,
            'achievement_percent', v_achievement, 'target_bonus_egp', v_amount,
            'separate_from_performance_incentive', true
          )
      where id = v_existing_id;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.settle_target_achievement_bonus(date, date) from public, anon, authenticated;
grant execute on function public.settle_target_achievement_bonus(date, date) to service_role;
