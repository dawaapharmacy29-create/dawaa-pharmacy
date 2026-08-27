-- Branch-manager and customer-service performance incentive is settled from one
-- submitted 26 -> 25 cycle evaluation. Historical weekly rows remain a fallback
-- for completed cycles that predate this rollout. Branches-manager evaluation
-- remains weekly and requires 3 submitted evaluations.

create or replace function public.settle_manager_evaluation_incentive()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if extract(day from current_date) > 25 then
    v_cycle_end := (date_trunc('month', current_date) + interval '24 days')::date;
    v_cycle_start := (date_trunc('month', current_date) - interval '1 month' + interval '25 days')::date;
  else
    v_cycle_end := (date_trunc('month', current_date) - interval '1 month' + interval '24 days')::date;
    v_cycle_start := (date_trunc('month', current_date) - interval '2 months' + interval '25 days')::date;
  end if;
  v_cycle_label := to_char(v_cycle_start, 'YYYY-MM');

  for v_row in
    with monthly_direct as (
      select e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(max(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'monthly_cycle'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted' and e.evaluation_type in ('branch_manager','customer_service')
        and e.week_start=v_cycle_start and e.week_end=v_cycle_end
      group by e.subject_staff_id,e.evaluation_type
      having coalesce(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,0)>=80
    ), historical_weekly as (
      select e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(avg(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'historical_weekly_fallback'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted' and e.evaluation_type in ('branch_manager','customer_service')
        and coalesce(e.week_end,e.week_start) between v_cycle_start and v_cycle_end
        and not exists (
          select 1 from public.manager_weekly_evaluations m
          where m.status='submitted' and m.evaluation_type=e.evaluation_type
            and m.subject_staff_id=e.subject_staff_id and m.week_start=v_cycle_start and m.week_end=v_cycle_end
        )
      group by e.subject_staff_id,e.evaluation_type
      having count(distinct e.id)>=3
        and coalesce(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,0)>=80
    ), branches_weekly as (
      select e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(avg(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'weekly_average'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted' and e.evaluation_type='branches_manager'
        and coalesce(e.week_end,e.week_start) between v_cycle_start and v_cycle_end
      group by e.subject_staff_id,e.evaluation_type
      having count(distinct e.id)>=3
        and coalesce(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,0)>=80
    )
    select * from monthly_direct
    union all select * from historical_weekly
    union all select * from branches_weekly
  loop
    v_max := case v_row.evaluation_type when 'branch_manager' then 3000 when 'branches_manager' then 4000 else 2500 end;
    v_payout_percent := case
      when v_row.avg_score < 60 then 0 when v_row.avg_score < 70 then 40 when v_row.avg_score < 80 then 70
      when v_row.avg_score < 90 then 90 when v_row.avg_score < 95 then 100 else 110 end;
    v_incentive := round(v_max*v_payout_percent/100,0);

    select id into v_existing_id from public.employee_transactions
    where staff_id=v_row.subject_staff_id and source='manager_evaluation_settlement' and month_cycle=v_cycle_label limit 1;

    if v_existing_id is null then
      insert into public.employee_transactions(
        staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,
        employee_name,created_by,description,category,employee_visible,metadata
      ) values (
        v_row.subject_staff_id,'reward',0,0,v_incentive,'حافز أداء شهري محسوب من تقييم الدورة وبيانات التطبيق',
        'manager_evaluation_settlement',v_cycle_label,v_row.branch,'active',v_row.subject_name,'system_automation',
        'حافز أداء — درجة '||v_row.avg_score||'/100، تغطية '||v_row.data_coverage_percent||'%',
        'performance_incentive',true,
        jsonb_build_object('engine_version',5,'evaluation_type',v_row.evaluation_type,'score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_data_coverage_percent',80,
          'settlement_mode',v_row.settlement_mode,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
          'separate_from_target_bonus',true)
      );
    else
      update public.employee_transactions set amount=v_incentive,updated_at=now(),
        description='حافز أداء — درجة '||v_row.avg_score||'/100، تغطية '||v_row.data_coverage_percent||'%',
        metadata=jsonb_build_object('engine_version',5,'evaluation_type',v_row.evaluation_type,'score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_data_coverage_percent',80,
          'settlement_mode',v_row.settlement_mode,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
          'separate_from_target_bonus',true)
      where id=v_existing_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
