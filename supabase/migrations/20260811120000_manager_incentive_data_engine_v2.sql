-- Unified, evidence-based manager metrics and incentive settlement.
-- The score sources are operational tables; missing module data is exposed in
-- data_coverage and must be treated as neutral by the client, never as failure.

create or replace function public.calculate_weekly_manager_metrics_v2(
  p_evaluation_type text,
  p_branch text,
  p_week_start date,
  p_week_end date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_sales numeric := 0; v_sales_count int := 0; v_coded_sales int := 0; v_target numeric := 0;
  v_purchases numeric := 0; v_purchases_count int := 0;
  v_inventory_due int := 0; v_inventory_closed int := 0; v_inventory_overdue int := 0;
  v_followups_total int := 0; v_followups_expired int := 0; v_followups_closed int := 0; v_followups_purchase numeric := 0;
  v_attendance_days int := 0; v_late_minutes numeric := 0; v_missing_punch int := 0;
  v_active_customers int := 0; v_vip_customers int := 0; v_vip_active int := 0; v_new_customers int := 0;
  v_reviews_count int := 0; v_reviews_avg numeric;
  v_points_total int := 0; v_points_contacted int := 0;
  v_requests_total int := 0; v_requests_closed int := 0; v_requests_on_time int := 0; v_requests_overdue int := 0;
  v_shift_total int := 0; v_shift_completed int := 0; v_shift_overdue int := 0;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'invalid manager metrics period';
  end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then
    raise exception 'invalid evaluation type';
  end if;

  select coalesce(sum(coalesce(net_amount,net_total,amount,total_amount,0)),0), count(*),
         count(*) filter (where customer_id is not null or nullif(btrim(customer_code),'') is not null)
    into v_sales,v_sales_count,v_coded_sales
  from public.sales_invoices
  where invoice_date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select coalesce(sum(
    target_amount * greatest(0, least(cycle_end,p_week_end)-greatest(cycle_start,p_week_start)+1)::numeric
    / greatest(1,cycle_end-cycle_start+1)
  ),0) into v_target
  from public.branch_sales_targets_v13
  where cycle_end >= p_week_start and cycle_start <= p_week_end and (p_branch is null or branch=p_branch);

  select coalesce(sum(net_total),0),count(*) into v_purchases,v_purchases_count
  from public.purchase_invoices_v13
  where invoice_date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*) filter(where due_date between p_week_start and p_week_end),
         count(*) filter(where due_date between p_week_start and p_week_end and status='closed' and closed_at::date<=due_date),
         count(*) filter(where due_date between p_week_start and p_week_end and (status<>'closed' or closed_at::date>due_date))
    into v_inventory_due,v_inventory_closed,v_inventory_overdue
  from public.inventory_count_sessions where p_branch is null or branch=p_branch;

  select count(*),
         count(*) filter(where closed_at is null and coalesce(open_case,true) and created_at<=p_week_end+interval '1 day'-interval '48 hours'),
         count(*) filter(where closed_at is not null and closed_at::date between p_week_start and p_week_end),
         coalesce(sum(coalesce(purchase_amount,0)) filter(where coalesce(purchase_after_followup,false)),0)
    into v_followups_total,v_followups_expired,v_followups_closed,v_followups_purchase
  from public.daily_followups
  where created_at::date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*),coalesce(sum(late_minutes),0),count(*) filter(where missing_punch)
    into v_attendance_days,v_late_minutes,v_missing_punch
  from public.attendance_daily_summary
  where attendance_date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*) filter(where last_purchase>=p_week_start-interval '60 days'),
         count(*) filter(where coalesce(avg_monthly,0)>=2000),
         count(*) filter(where coalesce(avg_monthly,0)>=2000 and last_purchase>=p_week_start-interval '30 days'),
         count(*) filter(where first_purchase between p_week_start and p_week_end)
    into v_active_customers,v_vip_customers,v_vip_active,v_new_customers
  from public.customer_metrics_summary where p_branch is null or branch=p_branch;

  select count(*),avg(final_score) into v_reviews_count,v_reviews_avg
  from public.conversation_sales_reviews
  where created_at::date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*),count(*) filter(where contacted is true) into v_points_total,v_points_contacted
  from public.customer_points_ledger
  where created_at::date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*),
         count(*) filter(where status in ('delivered','completed','closed')),
         count(*) filter(where status in ('delivered','completed','closed') and (due_date is null or closed_at::date<=due_date)),
         count(*) filter(where status not in ('delivered','completed','closed','cancelled') and coalesce(due_date,created_at::date+2)<p_week_end)
    into v_requests_total,v_requests_closed,v_requests_on_time,v_requests_overdue
  from public.customer_requests
  where created_at::date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  select count(*),count(*) filter(where status='completed'),
         count(*) filter(where status not in ('completed','cancelled') and created_at<p_week_end+interval '1 day'-interval '48 hours')
    into v_shift_total,v_shift_completed,v_shift_overdue
  from public.shift_notes
  where created_at::date between p_week_start and p_week_end and (p_branch is null or branch=p_branch);

  v_result := jsonb_build_object(
    'sales_total',v_sales,'sales_invoices_count',v_sales_count,'coded_sales_invoices_count',v_coded_sales,
    'sales_coding_rate',case when v_sales_count>0 then round(v_coded_sales::numeric/v_sales_count*100,1) end,
    'sales_target_amount',v_target,'sales_target_achievement_rate',case when v_target>0 then round(v_sales/v_target*100,1) end,
    'purchases_total',v_purchases,'purchases_count',v_purchases_count,
    'inventory_sessions_due',v_inventory_due,'inventory_closed_on_time',v_inventory_closed,'inventory_overdue',v_inventory_overdue,
    'followups_total',v_followups_total,'followups_expired',v_followups_expired,'followups_closed',v_followups_closed,'followups_purchase_amount',v_followups_purchase,
    'attendance_days_count',v_attendance_days,'attendance_late_minutes',v_late_minutes,'attendance_missing_punch',v_missing_punch,
    'active_customers',v_active_customers,'vip_customers',v_vip_customers,'vip_customers_still_active',v_vip_active,
    'vip_retention_rate',case when v_vip_customers>0 then round(v_vip_active::numeric/v_vip_customers*100,1) end,
    'conversation_reviews_count',v_reviews_count,'conversation_reviews_avg_score',round(v_reviews_avg,1),
    'points_transactions_total',v_points_total,'points_transactions_contacted',v_points_contacted,'new_customers_count',v_new_customers,
    'customer_requests_total',v_requests_total,'customer_requests_closed',v_requests_closed,
    'customer_requests_closed_on_time',v_requests_on_time,'customer_requests_overdue',v_requests_overdue,
    'shift_notes_total',v_shift_total,'shift_notes_completed',v_shift_completed,'shift_notes_overdue',v_shift_overdue,
    'data_coverage',jsonb_build_object('sales',v_sales_count>0,'targets',v_target>0,'purchases',v_purchases_count>0,
      'inventory',v_inventory_due>0,'followups',v_followups_total>0,'attendance',v_attendance_days>0,
      'customers',v_active_customers>0,'reviews',v_reviews_count>0,'points',v_points_total>0,
      'customer_requests',v_requests_total>0,'shift_notes',v_shift_total>0)
  );
  return v_result;
end;
$$;

grant execute on function public.calculate_weekly_manager_metrics_v2(text,text,date,date) to anon, authenticated;

create or replace function public.settle_manager_evaluation_incentive()
returns integer language plpgsql security definer set search_path=public as $$
declare
  v_count int := 0; v_row record; v_cycle_start date; v_cycle_end date; v_cycle_label text;
  v_max numeric; v_payout_percent numeric; v_incentive numeric; v_existing_id uuid;
begin
  if extract(day from current_date)>=25 then
    v_cycle_start:=(date_trunc('month',current_date)+interval '24 days')::date;
    v_cycle_end:=(date_trunc('month',current_date)+interval '1 month'+interval '23 days')::date;
  else
    v_cycle_start:=(date_trunc('month',current_date)-interval '1 month'+interval '24 days')::date;
    v_cycle_end:=(date_trunc('month',current_date)+interval '23 days')::date;
  end if;
  v_cycle_label:=to_char(v_cycle_start,'YYYY-MM');

  for v_row in
    select subject_staff_id,subject_name,branch,evaluation_type,round(avg(total_score),2) avg_score,count(*) evals_count
    from public.manager_weekly_evaluations
    where status='submitted' and week_start between v_cycle_start and v_cycle_end
      and evaluation_type in ('branch_manager','branches_manager','customer_service')
    group by subject_staff_id,subject_name,branch,evaluation_type
  loop
    v_max:=case v_row.evaluation_type when 'branch_manager' then 3000 when 'branches_manager' then 4000 else 2500 end;
    v_payout_percent:=case when v_row.avg_score<60 then 0 when v_row.avg_score<70 then 40 when v_row.avg_score<80 then 70
      when v_row.avg_score<90 then 90 when v_row.avg_score<95 then 100 else 110 end;
    v_incentive:=round(v_max*v_payout_percent/100,0);
    select id into v_existing_id from public.employee_transactions
    where staff_id=v_row.subject_staff_id and source='manager_evaluation_settlement' and month_cycle=v_cycle_label limit 1;
    if v_existing_id is null then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,metadata)
      values(v_row.subject_staff_id,'reward',v_incentive,v_incentive,v_incentive,'حافز شهري محسوب من بيانات التطبيق','manager_evaluation_settlement',
        v_cycle_label,v_row.branch,'active',v_row.subject_name,'system_automation',
        'حافز تقييم أداء آلي — متوسط '||v_row.avg_score||'/100، شريحة '||v_payout_percent||'%، '||v_row.evals_count||' أسابيع معتمدة',
        jsonb_build_object('engine_version',2,'evaluation_type',v_row.evaluation_type,'average_score',v_row.avg_score,'payout_percent',v_payout_percent,
          'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end));
    else
      update public.employee_transactions set points=v_incentive,points_delta=v_incentive,amount=v_incentive,updated_at=now(),
        description='حافز تقييم أداء آلي — متوسط '||v_row.avg_score||'/100، شريحة '||v_payout_percent||'%، '||v_row.evals_count||' أسابيع معتمدة',
        metadata=jsonb_build_object('engine_version',2,'evaluation_type',v_row.evaluation_type,'average_score',v_row.avg_score,'payout_percent',v_payout_percent,
          'maximum_incentive_egp',v_max,'evaluations_count',v_row.evals_count,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end)
      where id=v_existing_id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.settle_manager_evaluation_incentive() from public, anon, authenticated;
grant execute on function public.settle_manager_evaluation_incentive() to service_role;
