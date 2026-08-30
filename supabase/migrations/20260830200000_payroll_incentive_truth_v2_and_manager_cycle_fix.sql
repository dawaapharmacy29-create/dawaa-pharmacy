-- Fix manager-evaluation cycle labels and expose one server-side payroll incentive truth.

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
  -- دورة 26→25 تُسمّى بشهر النهاية، مثل 26 أغسطس→25 سبتمبر = 2026-09.
  v_cycle_label := public.dawaa_points_cycle_label_for_date_v3(v_cycle_end);

  for v_row in
    with monthly_direct as (
      select
        e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(max(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'monthly_cycle'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted'
        and e.evaluation_type in ('branch_manager','customer_service')
        and e.week_start=v_cycle_start and e.week_end=v_cycle_end
      group by e.subject_staff_id,e.evaluation_type
      having coalesce(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,0)>=80
    ), historical_weekly as (
      select
        e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(avg(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'historical_weekly_fallback'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted'
        and e.evaluation_type in ('branch_manager','customer_service')
        and coalesce(e.week_end,e.week_start) between v_cycle_start and v_cycle_end
        and not exists (
          select 1 from public.manager_weekly_evaluations m
          where m.status='submitted'
            and m.evaluation_type=e.evaluation_type
            and m.subject_staff_id=e.subject_staff_id
            and m.week_start=v_cycle_start and m.week_end=v_cycle_end
        )
      group by e.subject_staff_id,e.evaluation_type
      having count(distinct e.id)>=3
        and coalesce(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,0)>=80
    ), branches_weekly as (
      select
        e.subject_staff_id,max(e.subject_name) subject_name,max(e.branch) branch,e.evaluation_type,
        round(avg(e.total_score),2) avg_score,count(distinct e.id)::integer evals_count,
        coalesce(round(count(*) filter(where cov.value::boolean)::numeric/nullif(count(cov.value),0)*100,1),0) data_coverage_percent,
        'weekly_average'::text settlement_mode
      from public.manager_weekly_evaluations e
      left join lateral jsonb_each(coalesce(e.auto_metrics->'data_coverage','{}'::jsonb)) cov on true
      where e.status='submitted'
        and e.evaluation_type='branches_manager'
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
        jsonb_build_object('engine_version',6,'evaluation_type',v_row.evaluation_type,'score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_data_coverage_percent',80,
          'settlement_mode',v_row.settlement_mode,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
          'month_cycle',v_cycle_label,'separate_from_target_bonus',true)
      );
    else
      update public.employee_transactions set amount=v_incentive,updated_at=now(),
        description='حافز أداء — درجة '||v_row.avg_score||'/100، تغطية '||v_row.data_coverage_percent||'%',
        metadata=jsonb_build_object('engine_version',6,'evaluation_type',v_row.evaluation_type,'score',v_row.avg_score,
          'payout_percent',v_payout_percent,'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,
          'data_coverage_percent',v_row.data_coverage_percent,'minimum_data_coverage_percent',80,
          'settlement_mode',v_row.settlement_mode,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
          'month_cycle',v_cycle_label,'separate_from_target_bonus',true)
      where id=v_existing_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.get_payroll_incentive_truth_v2(
  p_staff_id uuid,
  p_month_cycle text
)
returns table(
  staff_id uuid,
  month_cycle text,
  profile_configured boolean,
  performance_source text,
  points_incentive_egp numeric,
  competition_bonus_egp numeric,
  manager_evaluation_incentive_egp numeric,
  performance_incentive_egp numeric,
  target_bonus_egp numeric,
  followup_threshold_bonus_egp numeric,
  customer_request_threshold_bonus_egp numeric,
  branch_star_bonus_egp numeric,
  automated_incentives_total_egp numeric,
  excluded_manager_evaluation_due_to_points_profile boolean
)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_profile_configured boolean := false;
  v_points_incentive numeric := 0;
  v_competition_bonus numeric := 0;
  v_manager_eval numeric := 0;
  v_target numeric := 0;
  v_followup numeric := 0;
  v_customer_request numeric := 0;
  v_branch_star numeric := 0;
  v_performance numeric := 0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid payroll incentive truth input' using errcode='22023';
  end if;

  select sa.username
    into v_username
  from public.staff_accounts sa
  where sa.staff_id = p_staff_id::text
    and coalesce(sa.active,true)=true
    and coalesce(sa.can_login,true)=true
  order by sa.created_at nulls last
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not authorized to read payroll incentive truth' using errcode='42501';
  end if;

  select
    coalesce(t.profile_configured,false),
    coalesce(t.points_incentive_egp,0),
    coalesce(t.competition_bonus_egp,0)
  into v_profile_configured,v_points_incentive,v_competition_bonus
  from public.dawaa_staff_points_truth_v2(p_staff_id,p_month_cycle) t
  limit 1;

  select
    coalesce(sum(et.amount) filter(where et.source='manager_evaluation_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='target_achievement_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_followup_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_customer_request_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='branch_star_of_month'),0)
  into v_manager_eval,v_target,v_followup,v_customer_request,v_branch_star
  from public.employee_transactions et
  where et.staff_id=p_staff_id
    and et.month_cycle=p_month_cycle
    and et.status in ('active','approved')
    and et.source in (
      'manager_evaluation_settlement',
      'target_achievement_settlement',
      'doctor_followup_threshold_bonus',
      'doctor_customer_request_threshold_bonus',
      'branch_star_of_month'
    );

  -- If a staff member has the official points compensation profile, the points truth is
  -- the performance source and already includes the pillar competition bonus. Manager
  -- evaluation is only the performance source when no points profile exists.
  v_performance := case
    when v_profile_configured then v_points_incentive + v_competition_bonus
    else v_manager_eval
  end;

  return query select
    p_staff_id,
    p_month_cycle,
    v_profile_configured,
    case when v_profile_configured then 'points' when v_manager_eval<>0 then 'manager_evaluation' else 'none' end,
    v_points_incentive,
    v_competition_bonus,
    v_manager_eval,
    v_performance,
    v_target,
    v_followup,
    v_customer_request,
    v_branch_star,
    v_performance + v_target + v_followup + v_customer_request + v_branch_star,
    (v_profile_configured and v_manager_eval<>0);
end;
$function$;

revoke all on function public.get_payroll_incentive_truth_v2(uuid,text) from public;
grant execute on function public.get_payroll_incentive_truth_v2(uuid,text) to anon, authenticated, service_role;
