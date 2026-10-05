-- Server-authoritative objective score for manager evaluations.
create or replace function public.dawaa_manager_evaluation_objective_v5(
  p_type text,p_subject_id uuid,p_branch text,p_start date,p_end date
) returns jsonb
language plpgsql security definer
set search_path='public','pg_catalog'
as $function$
declare
  c jsonb; p jsonb; k jsonb; cad jsonb;
  ps date; pe date; span int;
  scores jsonb:='{}'::jsonb;
  total numeric:=0; s numeric:=0;
  cur numeric; prev numeric; rate numeric;
begin
  if p_type not in ('branch_manager','branches_manager','customer_service') or p_subject_id is null or p_start is null or p_end<p_start then
    raise exception 'invalid manager objective request' using errcode='22023';
  end if;
  span:=p_end-p_start+1;
  if span>14 then ps:=(p_start-interval '1 month')::date; pe:=(p_end-interval '1 month')::date;
  else ps:=p_start-7; pe:=p_end-7; end if;

  c:=public.calculate_weekly_manager_metrics_v5(p_type,p_branch,p_start,p_end);
  p:=public.calculate_weekly_manager_metrics_v5(p_type,p_branch,ps,pe);

  cad:=jsonb_build_object(
    'cash_reconciliation','daily','purchases_review','weekly','inventory_review','weekly',
    'branch_appearance_cleanliness_audit','daily','floor_cleanliness','daily',
    'shortages_handling','daily','expiry_check','weekly','team_briefing','daily',
    'warehouse_review','weekly','top20_customers_retention_review','weekly',
    'purchases_speed_availability_review','daily','shift_notes_compliance_review','daily',
    'infrastructure_check','weekly','consumables_check','daily','stagnant_compliance_review','daily',
    'classification_accuracy_review','weekly','doctor_coaching','weekly',
    'cross_selling_review','weekly','up_selling_review','weekly',
    'branches_manager_notes_followup','daily'
  );
  k:=public.calculate_weekly_checklist_completion_v4(p_subject_id::text,p_start,p_end,cad,p_branch);

  if p_type in ('branch_manager','branches_manager') then
    rate:=nullif(c->>'sales_target_achievement_rate','')::numeric;
    cur:=coalesce(nullif(c->>'sales_total','')::numeric,0);
    prev:=coalesce(nullif(p->>'sales_total','')::numeric,0);
    if rate is not null then s:=greatest(0,least(10,rate/10));
    elsif prev=0 then s:=case when cur>0 then 5 else 0 end;
    else s:=greatest(0,least(10,5+((cur-prev)/prev*100)/5)); end if;
    scores:=scores||jsonb_build_object('sales',round(s,1));
    total:=total+s*(case when p_type='branch_manager' then .20 else .19 end)*10;

    cur:=coalesce(nullif(c->>'followups_total','')::numeric,0);
    if cur=0 then s:=0; else s:=greatest(0,least(10,
      coalesce(nullif(c->>'followups_closed','')::numeric,0)/cur*10-
      coalesce(nullif(c->>'followups_expired','')::numeric,0)/cur*5)); end if;
    scores:=scores||jsonb_build_object('customer_service',round(s,1));
    total:=total+s*(case when p_type='branch_manager' then .15 else .17 end)*10;

    rate:=nullif(c->>'vip_retention_rate','')::numeric;
    s:=case when rate is null then 0 else greatest(0,least(10,rate/10)) end;
    scores:=scores||jsonb_build_object('vip_retention',round(s,1));
    total:=total+s*.10*10;
  end if;

  if p_type='branch_manager' then
    foreach cur in array array[0] loop null; end loop;
    s:=coalesce(nullif(k->>'cash_reconciliation','')::numeric,0)/10; scores:=scores||jsonb_build_object('cash_integrity',round(s,1)); total:=total+s*.10*10;
    cur:=coalesce(nullif(c->>'customer_requests_total','')::numeric,0);
    if cur=0 then s:=5; else s:=greatest(0,least(10,
      coalesce(nullif(c->>'customer_requests_closed_on_time','')::numeric,0)/cur*10-
      coalesce(nullif(c->>'customer_requests_overdue','')::numeric,0)/cur*5)); end if;
    scores:=scores||jsonb_build_object('complaints_handling',round(s,1)); total:=total+s*.10*10;
    s:=coalesce(nullif(k->>'purchases_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('purchases',round(s,1)); total:=total+s*.08*10;
    s:=coalesce(nullif(k->>'inventory_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('inventory',round(s,1)); total:=total+s*.03*10;
    s:=(coalesce(nullif(k->>'branch_appearance_cleanliness_audit','')::numeric,0)+coalesce(nullif(k->>'floor_cleanliness','')::numeric,0))/20;
    scores:=scores||jsonb_build_object('cleanliness_compliance',round(s,1)); total:=total+s*.05*10;
    s:=coalesce(nullif(k->>'shortages_handling','')::numeric,0)/10; scores:=scores||jsonb_build_object('shortages_handling',round(s,1)); total:=total+s*.05*10;
    s:=coalesce(nullif(k->>'expiry_check','')::numeric,0)/10; scores:=scores||jsonb_build_object('expiry_compliance',round(s,1)); total:=total+s*.04*10;
    s:=coalesce(nullif(k->>'team_briefing','')::numeric,0)/10; scores:=scores||jsonb_build_object('shift_briefing',round(s,1)); total:=total+s*.03*10;
    cur:=coalesce(nullif(c->>'attendance_days_count','')::numeric,0);
    if cur=0 then s:=5; else s:=greatest(0,least(10,10-least(5,coalesce(nullif(c->>'attendance_late_minutes','')::numeric,0)/greatest(1,cur)/12)-least(5,coalesce(nullif(c->>'attendance_missing_punch','')::numeric,0)/greatest(1,cur)*5))); end if;
    scores:=scores||jsonb_build_object('attendance',round(s,1)); total:=total+s*.07*10;
  elsif p_type='branches_manager' then
    cur:=coalesce(nullif(c->>'shift_notes_total','')::numeric,0);
    if cur>0 then s:=greatest(0,least(10,coalesce(nullif(c->>'shift_notes_completed','')::numeric,0)/cur*10-coalesce(nullif(c->>'shift_notes_overdue','')::numeric,0)/cur*5));
    else
      cur:=coalesce(nullif(c->>'customer_requests_total','')::numeric,0);
      if cur=0 then s:=5; else s:=greatest(0,least(10,coalesce(nullif(c->>'customer_requests_closed_on_time','')::numeric,0)/cur*10-coalesce(nullif(c->>'customer_requests_overdue','')::numeric,0)/cur*5)); end if;
    end if;
    scores:=scores||jsonb_build_object('coordination',round(s,1)); total:=total+s*.08*10;
    s:=coalesce(nullif(k->>'warehouse_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('warehouse',round(s,1)); total:=total+s*.08*10;
    s:=coalesce(nullif(k->>'top20_customers_retention_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('top20_customers',round(s,1)); total:=total+s*.08*10;
    s:=coalesce(nullif(k->>'purchases_speed_availability_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('purchases_speed',round(s,1)); total:=total+s*.07*10;
    s:=coalesce(nullif(k->>'shift_notes_compliance_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('shift_notes_compliance',round(s,1)); total:=total+s*.05*10;
    s:=coalesce(nullif(k->>'infrastructure_check','')::numeric,0)/10; scores:=scores||jsonb_build_object('infrastructure',round(s,1)); total:=total+s*.04*10;
    s:=coalesce(nullif(k->>'consumables_check','')::numeric,0)/10; scores:=scores||jsonb_build_object('consumables',round(s,1)); total:=total+s*.03*10;
    s:=coalesce(nullif(k->>'stagnant_compliance_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('stagnant_compliance',round(s,1)); total:=total+s*.05*10;
    scores:=scores||jsonb_build_object('leadership',round(coalesce((scores->>'coordination')::numeric,5),1)); total:=total+coalesce((scores->>'coordination')::numeric,5)*.06*10;
  else
    cur:=coalesce(nullif(c->>'conversation_reviews_count','')::numeric,0);
    if cur=0 then s:=0; else s:=least(10,cur)*.4+greatest(0,least(10,coalesce(nullif(c->>'conversation_reviews_avg_score','')::numeric,0)/10))*.6; end if;
    scores:=scores||jsonb_build_object('conversation_quality',round(s,1)); total:=total+s*.18*10;
    cur:=coalesce(nullif(c->>'followups_total','')::numeric,0);
    if cur=0 then s:=0; else s:=greatest(0,least(10,coalesce(nullif(c->>'followups_closed','')::numeric,0)/cur*10-coalesce(nullif(c->>'followups_expired','')::numeric,0)/cur*5)); end if;
    scores:=scores||jsonb_build_object('followups_execution',round(s,1)); total:=total+s*.14*10;
    rate:=nullif(c->>'daily_queues_completion_rate','')::numeric; s:=case when rate is null then 0 else greatest(0,least(10,rate/10)) end;
    scores:=scores||jsonb_build_object('daily_queues_execution',round(s,1)); total:=total+s*.10*10;
    cur:=coalesce(nullif(c->>'points_transactions_total','')::numeric,0);
    s:=case when cur=0 then 0 else greatest(0,least(10,coalesce(nullif(c->>'points_transactions_contacted','')::numeric,0)/cur*10)) end;
    scores:=scores||jsonb_build_object('points_communication',round(s,1)); total:=total+s*.04*10;
    cur:=coalesce(nullif(c->>'new_customers_count','')::numeric,0); prev:=coalesce(nullif(p->>'new_customers_count','')::numeric,0);
    if prev=0 then s:=case when cur>0 then 5 else 0 end; else s:=greatest(0,least(10,5+((cur-prev)/prev*100)/10)); end if;
    scores:=scores||jsonb_build_object('customer_growth',round(s,1)); total:=total+s*.08*10;
    rate:=nullif(c->>'vip_retention_rate','')::numeric; s:=case when rate is null then 0 else greatest(0,least(10,rate/10)) end;
    scores:=scores||jsonb_build_object('vip_retention',round(s,1)); total:=total+s*.15*10;
    s:=coalesce(nullif(k->>'classification_accuracy_review','')::numeric,0)/10; scores:=scores||jsonb_build_object('classification_accuracy',round(s,1)); total:=total+s*.10*10;
    s:=coalesce(nullif(k->>'doctor_coaching','')::numeric,0)/10; scores:=scores||jsonb_build_object('doctor_coaching',round(s,1)); total:=total+s*.08*10;
    s:=(coalesce(nullif(k->>'cross_selling_review','')::numeric,0)+coalesce(nullif(k->>'up_selling_review','')::numeric,0))/20;
    scores:=scores||jsonb_build_object('sales_quality',round(s,1)); total:=total+s*.08*10;
    s:=coalesce(nullif(k->>'branches_manager_notes_followup','')::numeric,0)/10; scores:=scores||jsonb_build_object('branches_manager_alignment',round(s,1)); total:=total+s*.05*10;
  end if;

  return jsonb_build_object('objective_score',round(total,1),'criterion_system_scores',scores,'metrics',c,'previous_metrics',p,'checklist_rates',k,'validated_at',now());
end;
$function$;

revoke all on function public.dawaa_manager_evaluation_objective_v5(text,uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.dawaa_manager_evaluation_objective_v5(text,uuid,text,date,date) to service_role;

notify pgrst,'reload schema';
