-- Canonical manager evaluation write command.
-- Identity, subject, cycle and final score composition are server-validated.
create or replace function public.save_manager_weekly_evaluation_v5(p_payload jsonb)
returns public.manager_weekly_evaluations
language plpgsql security definer
set search_path='public','pg_catalog'
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_actor public.staff_accounts%rowtype;
  v_subject public.staff%rowtype;
  v_actor_staff_id uuid;
  v_type text:=nullif(trim(p_payload->>'evaluation_type'),'');
  v_subject_id uuid:=nullif(p_payload->>'subject_staff_id','')::uuid;
  v_branch text:=coalesce(p_payload->>'branch','');
  v_start date:=nullif(p_payload->>'week_start','')::date;
  v_end date:=nullif(p_payload->>'week_end','')::date;
  v_status text:=coalesce(nullif(trim(p_payload->>'status'),''),'draft');
  v_auto jsonb:=coalesce(p_payload->'auto_metrics','{}'::jsonb);
  v_manual jsonb:=coalesce(p_payload->'manual_scores','{}'::jsonb);
  v_objective numeric;
  v_manager numeric;
  v_total numeric;
  v_expected numeric;
  v_row public.manager_weekly_evaluations%rowtype;
  v_score record;
begin
  if v_session_id is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select * into v_actor from public.staff_accounts
  where id=v_session_id and coalesce(active,false) and coalesce(can_login,false) limit 1;
  if not found then raise exception 'unauthorized' using errcode='42501'; end if;
  if v_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type' using errcode='22023'; end if;
  if (v_type='branch_manager' and lower(v_actor.role) not in ('general_manager','executive_manager','branches_manager'))
     or(v_type='branches_manager' and lower(v_actor.role)<>'general_manager')
     or(v_type='customer_service' and lower(v_actor.role) not in ('general_manager','executive_manager','branches_manager'))
  then raise exception 'not allowed' using errcode='42501'; end if;
  if v_subject_id is null or v_start is null or v_end is null or v_end<v_start then raise exception 'invalid evaluation identity or period' using errcode='22023'; end if;
  select s.id into v_actor_staff_id from public.staff s where s.id::text=v_actor.staff_id limit 1;
  if v_actor_staff_id is null then raise exception 'actor staff link missing' using errcode='42501'; end if;
  select * into v_subject from public.staff where id=v_subject_id and coalesce(active,is_active,true) limit 1;
  if not found then raise exception 'subject not found' using errcode='22023'; end if;
  if v_actor_staff_id=v_subject_id then raise exception 'self evaluation not allowed' using errcode='42501'; end if;
  if (v_type='branch_manager' and coalesce(v_subject.role,v_subject.type,'') !~* 'branch_manager')
     or(v_type='branches_manager' and coalesce(v_subject.role,v_subject.type,'') !~* 'branches_manager')
     or(v_type='customer_service' and coalesce(v_subject.role,v_subject.type,'') !~* 'customer_service|team_dawaa_alpha|خدمة العملاء')
  then raise exception 'subject role mismatch' using errcode='22023'; end if;
  if coalesce(v_subject.branch,'')<>v_branch and v_type<>'branches_manager' then raise exception 'subject branch mismatch' using errcode='22023'; end if;
  if v_status not in ('draft','submitted') then raise exception 'invalid status' using errcode='22023'; end if;

  -- Manual manager judgments are always 0..10. Submitted rows cannot contain malformed scores.
  for v_score in select key,value from jsonb_each(v_manual) loop
    if jsonb_typeof(v_score.value)<>'number' or (v_score.value#>>'{}')::numeric<0 or (v_score.value#>>'{}')::numeric>10 then
      raise exception 'invalid manual score' using errcode='22023';
    end if;
  end loop;

  v_objective:=nullif(v_auto->>'__objective_score','')::numeric;
  v_manager:=nullif(v_auto->>'__manager_judgment_score','')::numeric;
  v_total:=nullif(p_payload->>'total_score','')::numeric;
  if v_objective is null or v_objective<0 or v_objective>100 then raise exception 'invalid objective score' using errcode='22023'; end if;
  if v_manager is null or v_manager<0 or v_manager>100 then raise exception 'invalid manager score' using errcode='22023'; end if;
  if coalesce((v_auto->>'__system_performance_weight')::numeric,-1)<>0.8
     or coalesce((v_auto->>'__manager_judgment_weight')::numeric,-1)<>0.2 then
    raise exception 'invalid evaluation weights' using errcode='22023';
  end if;
  v_expected:=round((v_objective*0.8+v_manager*0.2)::numeric,1);
  if v_total is null or abs(v_total-v_expected)>0.001 then raise exception 'manager_evaluation_score_mismatch' using errcode='22023'; end if;

  insert into public.manager_weekly_evaluations(
    evaluation_type,subject_staff_id,subject_name,branch,evaluator_staff_id,evaluator_name,
    week_start,week_end,auto_metrics,manual_scores,manual_note,total_score,status,submitted_at,updated_at
  ) values(
    v_type,v_subject.id,v_subject.name,v_branch,v_actor_staff_id,coalesce(v_actor.name,v_actor.username),
    v_start,v_end,v_auto,v_manual,nullif(p_payload->>'manual_note',''),v_total,v_status,
    case when v_status='submitted' then now() else null end,now()
  )
  on conflict(evaluation_type,subject_staff_id,week_start,branch) do update set
    subject_name=excluded.subject_name,evaluator_staff_id=excluded.evaluator_staff_id,evaluator_name=excluded.evaluator_name,
    week_end=excluded.week_end,auto_metrics=excluded.auto_metrics,manual_scores=excluded.manual_scores,
    manual_note=excluded.manual_note,total_score=excluded.total_score,status=excluded.status,
    submitted_at=case when excluded.status='submitted' then coalesce(public.manager_weekly_evaluations.submitted_at,now()) else null end,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.save_manager_weekly_evaluation_v5(jsonb) from public,anon;
grant execute on function public.save_manager_weekly_evaluation_v5(jsonb) to authenticated,service_role;

-- Browser writes are retired; all mutations must pass the command above.
revoke insert,update,delete on public.manager_weekly_evaluations from anon,authenticated;
drop policy if exists manager_weekly_evaluations_admin_insert_v2 on public.manager_weekly_evaluations;
drop policy if exists manager_weekly_evaluations_admin_update_v2 on public.manager_weekly_evaluations;
drop policy if exists manager_weekly_evaluations_admin_delete_v2 on public.manager_weekly_evaluations;

notify pgrst,'reload schema';
