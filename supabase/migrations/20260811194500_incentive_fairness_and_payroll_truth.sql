-- Fair payout gates and one canonical automated-incentive source for payroll.

create or replace view public.staff_payroll_incentive_truth_v1
with (security_invoker = true)
as
select
  staff_id,
  month_cycle,
  sum(amount) filter (where source = 'manager_evaluation_settlement')::numeric as performance_incentive,
  sum(amount) filter (where source = 'target_achievement_settlement')::numeric as target_bonus,
  sum(amount) filter (where source in ('manager_evaluation_settlement','target_achievement_settlement'))::numeric as automated_incentives_total,
  count(*) filter (where source = 'manager_evaluation_settlement')::integer as performance_records,
  count(*) filter (where source = 'target_achievement_settlement')::integer as target_records
from public.employee_transactions
where status in ('active','approved')
  and source in ('manager_evaluation_settlement','target_achievement_settlement')
  and month_cycle is not null
group by staff_id, month_cycle;

revoke all on public.staff_payroll_incentive_truth_v1 from anon;
revoke insert, update, delete, truncate, references, trigger on public.staff_payroll_incentive_truth_v1 from authenticated;
grant select on public.staff_payroll_incentive_truth_v1 to authenticated;

create or replace function public.settle_manager_evaluation_incentive()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
  v_cycle_start date;
  v_cycle_end date;
  v_cycle_label text;
  v_max numeric;
  v_payout_percent numeric;
  v_incentive numeric;
  v_existing_id uuid;
begin
  -- Always settle the most recently completed 26 -> 25 cycle.
  if extract(day from current_date) > 25 then
    v_cycle_end := (date_trunc('month', current_date) + interval '24 days')::date;
    v_cycle_start := (date_trunc('month', current_date) - interval '1 month' + interval '25 days')::date;
  else
    v_cycle_end := (date_trunc('month', current_date) - interval '1 month' + interval '24 days')::date;
    v_cycle_start := (date_trunc('month', current_date) - interval '2 months' + interval '25 days')::date;
  end if;
  v_cycle_label := to_char(v_cycle_start, 'YYYY-MM');

  for v_row in
    select
      e.subject_staff_id, max(e.subject_name) subject_name, max(e.branch) branch, e.evaluation_type,
      round(avg(e.total_score), 2) avg_score,
      count(distinct e.id)::integer evals_count,
      coalesce(round(
        count(*) filter (where cov.value::boolean)::numeric / nullif(count(cov.value), 0) * 100, 1
      ), 0) data_coverage_percent
    from public.manager_weekly_evaluations e
    left join lateral jsonb_each(coalesce(e.auto_metrics -> 'data_coverage', '{}'::jsonb)) cov on true
    where e.status = 'submitted'
      and coalesce(e.week_end, e.week_start) between v_cycle_start and v_cycle_end
      and e.evaluation_type in ('branch_manager','branches_manager','customer_service')
    group by e.subject_staff_id, e.evaluation_type
    having count(distinct e.id) >= 3
       and coalesce(count(*) filter (where cov.value::boolean)::numeric / nullif(count(cov.value), 0) * 100, 0) >= 80
  loop
    v_max := case v_row.evaluation_type when 'branch_manager' then 3000 when 'branches_manager' then 4000 else 2500 end;
    v_payout_percent := case
      when v_row.avg_score < 60 then 0 when v_row.avg_score < 70 then 40 when v_row.avg_score < 80 then 70
      when v_row.avg_score < 90 then 90 when v_row.avg_score < 95 then 100 else 110 end;
    v_incentive := round(v_max * v_payout_percent / 100, 0);

    select id into v_existing_id from public.employee_transactions
    where staff_id = v_row.subject_staff_id and source = 'manager_evaluation_settlement' and month_cycle = v_cycle_label limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions(
        staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,
        employee_name,created_by,description,category,employee_visible,metadata
      ) values (
        v_row.subject_staff_id,'reward',0,0,v_incentive,'حافز أداء شهري محسوب من بيانات التطبيق',
        'manager_evaluation_settlement',v_cycle_label,v_row.branch,'active',v_row.subject_name,'system_automation',
        'حافز أداء — متوسط '||v_row.avg_score||'/100، تغطية '||v_row.data_coverage_percent||
          ||'%، '||v_row.evals_count||' أسابيع معتمدة','performance_incentive',true,
        jsonb_build_object('engine_version',3,'evaluation_type',v_row.evaluation_type,'average_score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_approved_weeks',3,'minimum_data_coverage_percent',80,
          'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'separate_from_target_bonus',true)
      );
    else
      update public.employee_transactions set amount=v_incentive,updated_at=now(),
        description='حافز أداء — متوسط '||v_row.avg_score||'/100، تغطية '||v_row.data_coverage_percent
          ||'%، '||v_row.evals_count||' أسابيع معتمدة',
        metadata=jsonb_build_object('engine_version',3,'evaluation_type',v_row.evaluation_type,'average_score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_approved_weeks',3,'minimum_data_coverage_percent',80,
          'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'separate_from_target_bonus',true)
      where id=v_existing_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.settle_manager_evaluation_incentive() from public, anon, authenticated;
grant execute on function public.settle_manager_evaluation_incentive() to service_role;

alter function public.settle_target_achievement_bonus(date, date)
  rename to settle_target_achievement_bonus_v1_internal;

revoke all on function public.settle_target_achievement_bonus_v1_internal(date, date) from public, anon, authenticated;

create function public.settle_target_achievement_bonus(p_cycle_start date, p_cycle_end date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_cycle_end >= current_date then
    raise exception 'target bonus can only be settled after the cycle closes';
  end if;
  -- Preserve the verified v1 implementation while enforcing the financial close gate.
  select public.settle_target_achievement_bonus_v1_internal(p_cycle_start, p_cycle_end) into v_count;
  return v_count;
end;
$$;

revoke all on function public.settle_target_achievement_bonus(date, date) from public, anon, authenticated;
grant execute on function public.settle_target_achievement_bonus(date, date) to service_role;
grant execute on function public.settle_target_achievement_bonus_v1_internal(date, date) to service_role;
