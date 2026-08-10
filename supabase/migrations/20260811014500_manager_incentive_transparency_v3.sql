-- Align manager incentive settlement with the pharmacy's canonical cycle:
-- 26th of a month through 25th of the following month.
-- A weekly evaluation belongs to the cycle containing its closing day (week_end).

create or replace function public.settle_manager_evaluation_incentive()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row record;
  v_cycle_start date;
  v_cycle_end date;
  v_cycle_label text;
  v_max numeric;
  v_payout_percent numeric;
  v_incentive numeric;
  v_existing_id uuid;
begin
  if extract(day from current_date) >= 26 then
    v_cycle_start := (date_trunc('month', current_date) + interval '25 days')::date;
    v_cycle_end := (date_trunc('month', current_date) + interval '1 month' + interval '24 days')::date;
  else
    v_cycle_start := (date_trunc('month', current_date) - interval '1 month' + interval '25 days')::date;
    v_cycle_end := (date_trunc('month', current_date) + interval '24 days')::date;
  end if;
  v_cycle_label := to_char(v_cycle_start, 'YYYY-MM');

  for v_row in
    select
      subject_staff_id,
      subject_name,
      branch,
      evaluation_type,
      round(avg(total_score), 2) as avg_score,
      count(*) as evals_count
    from public.manager_weekly_evaluations
    where status = 'submitted'
      and coalesce(week_end, week_start) between v_cycle_start and v_cycle_end
      and evaluation_type in ('branch_manager', 'branches_manager', 'customer_service')
    group by subject_staff_id, subject_name, branch, evaluation_type
  loop
    v_max := case v_row.evaluation_type
      when 'branch_manager' then 3000
      when 'branches_manager' then 4000
      else 2500
    end;
    v_payout_percent := case
      when v_row.avg_score < 60 then 0
      when v_row.avg_score < 70 then 40
      when v_row.avg_score < 80 then 70
      when v_row.avg_score < 90 then 90
      when v_row.avg_score < 95 then 100
      else 110
    end;
    v_incentive := round(v_max * v_payout_percent / 100, 0);

    select id into v_existing_id
    from public.employee_transactions
    where staff_id = v_row.subject_staff_id
      and source = 'manager_evaluation_settlement'
      and month_cycle = v_cycle_label
    limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions (
        staff_id, type, points, points_delta, amount, reason, source,
        month_cycle, branch, status, employee_name, created_by, description, metadata
      ) values (
        v_row.subject_staff_id, 'reward', v_incentive, v_incentive, v_incentive,
        'حافز شهري محسوب من بيانات التطبيق', 'manager_evaluation_settlement',
        v_cycle_label, v_row.branch, 'active', v_row.subject_name, 'system_automation',
        'حافز تقييم أداء آلي — متوسط ' || v_row.avg_score || '/100، شريحة ' || v_payout_percent || '%، ' || v_row.evals_count || ' أسابيع معتمدة',
        jsonb_build_object(
          'engine_version', 3,
          'evaluation_type', v_row.evaluation_type,
          'average_score', v_row.avg_score,
          'payout_percent', v_payout_percent,
          'maximum_incentive_egp', v_max,
          'evaluations_count', v_row.evals_count,
          'cycle_start', v_cycle_start,
          'cycle_end', v_cycle_end,
          'cycle_rule', '26_to_25',
          'evaluation_cycle_basis', 'week_end',
          'formula', 'tiered_manager_incentive_v3'
        )
      );
    else
      update public.employee_transactions
      set points = v_incentive,
          points_delta = v_incentive,
          amount = v_incentive,
          updated_at = now(),
          description = 'حافز تقييم أداء آلي — متوسط ' || v_row.avg_score || '/100، شريحة ' || v_payout_percent || '%، ' || v_row.evals_count || ' أسابيع معتمدة',
          metadata = jsonb_build_object(
            'engine_version', 3,
            'evaluation_type', v_row.evaluation_type,
            'average_score', v_row.avg_score,
            'payout_percent', v_payout_percent,
            'maximum_incentive_egp', v_max,
            'evaluations_count', v_row.evals_count,
            'cycle_start', v_cycle_start,
            'cycle_end', v_cycle_end,
            'cycle_rule', '26_to_25',
            'evaluation_cycle_basis', 'week_end',
            'formula', 'tiered_manager_incentive_v3'
          )
      where id = v_existing_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.settle_manager_evaluation_incentive() from public, anon, authenticated;
grant execute on function public.settle_manager_evaluation_incentive() to service_role;
