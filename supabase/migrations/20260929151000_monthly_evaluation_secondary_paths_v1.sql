-- Monthly evaluation secondary paths hardening V1.
-- 1) Manager/customer-service leadership monthly evaluations must represent a complete 26->25 cycle.
-- 2) Doctor customer-service monthly evaluations can only be finalized after cycle close.
-- 3) Finalized payroll is immutable.
-- 4) Doctor evaluation points write through the canonical points V4 command, never direct ledger DML.

create or replace function public.trg_manager_monthly_evaluation_cycle_guard_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_today_cairo date := (now() at time zone 'Africa/Cairo')::date;
  v_expected_end date;
  v_month_cycle text;
begin
  if new.evaluation_type not in ('branch_manager','customer_service') then
    return new;
  end if;

  v_expected_end := (date_trunc('month',new.week_start)::date + interval '1 month 24 days')::date;
  v_month_cycle := to_char(new.week_end,'YYYY-MM');

  if extract(day from new.week_start) <> 26 or new.week_end <> v_expected_end then
    raise exception 'manager_monthly_evaluation_invalid_26_25_bounds'
      using errcode='22023',
            detail='Monthly branch/customer-service evaluations must use the complete 26 -> 25 cycle.';
  end if;

  if exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=new.subject_staff_id
      and f.month_cycle=v_month_cycle
  ) then
    raise exception 'manager_monthly_evaluation_payroll_finalized_immutable'
      using errcode='55000';
  end if;

  if tg_op='UPDATE'
     and old.status='submitted'
     and new.status<>'submitted' then
    raise exception 'manager_monthly_evaluation_final_status_regression_not_allowed'
      using errcode='55000';
  end if;

  if new.status='submitted' and v_today_cairo <= new.week_end then
    raise exception 'manager_monthly_evaluation_cycle_still_open'
      using errcode='55000',
            detail='Final monthly evaluation is available after the end of day 25 in Cairo time.';
  end if;

  return new;
end;
$function$;

drop trigger if exists manager_monthly_evaluation_cycle_guard_v1
  on public.manager_weekly_evaluations;

create trigger manager_monthly_evaluation_cycle_guard_v1
before insert or update on public.manager_weekly_evaluations
for each row
execute function public.trg_manager_monthly_evaluation_cycle_guard_v1();


create or replace function public.trg_doctor_customer_service_monthly_guard_v2()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle_end date;
  v_today_cairo date := (now() at time zone 'Africa/Cairo')::date;
  v_month_cycle text;
begin
  v_cycle_end := (date_trunc('month',new.evaluation_month)::date + interval '24 days')::date;
  v_month_cycle := to_char(new.evaluation_month,'YYYY-MM');

  if exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=new.doctor_id
      and f.month_cycle=v_month_cycle
  ) then
    raise exception 'doctor_customer_service_evaluation_payroll_finalized_immutable'
      using errcode='55000';
  end if;

  if tg_op='UPDATE'
     and old.status in ('sent','approved')
     and new.status not in ('sent','approved') then
    raise exception 'doctor_customer_service_evaluation_final_status_regression_not_allowed'
      using errcode='55000';
  end if;

  if new.status in ('sent','approved') and v_today_cairo <= v_cycle_end then
    raise exception 'doctor_customer_service_evaluation_cycle_still_open'
      using errcode='55000',
            detail='Final customer-service evaluation is available after the end of day 25 in Cairo time.';
  end if;

  return new;
end;
$function$;

drop trigger if exists doctor_customer_service_monthly_guard_v2
  on public.doctor_customer_service_evaluations;

create trigger doctor_customer_service_monthly_guard_v2
before insert or update on public.doctor_customer_service_evaluations
for each row
execute function public.trg_doctor_customer_service_monthly_guard_v2();


create or replace function public.save_doctor_customer_service_evaluation_safe(
  p_actor_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_id uuid;
  v_month date;
  v_score numeric;
  v_points numeric;
  v_status text;
begin
  select * into v_actor
  from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized' using errcode='42501'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(v_actor.staff_id,v_actor.role) then
    raise exception 'not allowed' using errcode='42501';
  end if;

  select * into v_target
  from public.staff
  where id=nullif(p_payload->>'doctor_id','')::uuid;
  if not found then raise exception 'doctor not found' using errcode='22023'; end if;

  if coalesce(v_target.role,v_target.type,'') !~* 'pharmac|صيدل|دكتور|doctor'
     or coalesce(v_target.role,v_target.type,'') ~* 'branch_manager|customer_service|خدمة العملاء|assistant|مساعد|clean' then
    raise exception 'target must be doctor' using errcode='22023';
  end if;

  if v_actor.role='customer_service_manager'
     and not exists(
       select 1 from public.assistant_operational_eligible_staff
       where staff_id=v_actor.staff_id
     )
     and coalesce(v_target.branch,'')<>v_actor.branch then
    raise exception 'branch scope denied' using errcode='42501';
  end if;

  v_month := nullif(p_payload->>'evaluation_month','')::date;
  v_score := round(greatest(0,least(100,coalesce((p_payload->>'overall_score')::numeric,0))),2);
  v_status := coalesce(nullif(trim(p_payload->>'status'),''),'draft');

  if v_month is null then
    raise exception 'evaluation_month_required' using errcode='22023';
  end if;
  if v_status not in ('draft','sent','approved') then
    raise exception 'invalid_doctor_customer_service_evaluation_status' using errcode='22023';
  end if;

  v_points := case
    when v_score>=95 then 20
    when v_score>=90 then 10
    when v_score>=80 then 5
    when v_score>=70 then 0
    when v_score>=60 then -5
    else -10
  end;

  insert into public.doctor_customer_service_evaluations(
    doctor_id,doctor_name,branch,evaluation_month,
    evaluator_id,evaluator_name,evaluator_role,
    sections,metrics_snapshot,overall_score,points_delta,notes,status,sent_at,updated_at
  )
  values(
    v_target.id,v_target.name,coalesce(v_target.branch,''),v_month,
    v_actor.account_id,v_actor.name,v_actor.role,
    coalesce(p_payload->'sections','[]'::jsonb),
    coalesce(p_payload->'metrics_snapshot','{}'::jsonb),
    v_score,v_points,p_payload->>'notes',v_status,
    case when v_status in ('sent','approved') then now() else null end,
    now()
  )
  on conflict(doctor_id,evaluation_month) do update set
    evaluator_id=excluded.evaluator_id,
    evaluator_name=excluded.evaluator_name,
    evaluator_role=excluded.evaluator_role,
    sections=excluded.sections,
    metrics_snapshot=excluded.metrics_snapshot,
    overall_score=excluded.overall_score,
    points_delta=excluded.points_delta,
    notes=excluded.notes,
    status=excluded.status,
    sent_at=case
      when excluded.status in ('sent','approved')
        then coalesce(public.doctor_customer_service_evaluations.sent_at,now())
      else public.doctor_customer_service_evaluations.sent_at
    end,
    updated_at=now()
  returning id into v_id;

  if v_status in ('sent','approved') then
    perform public.record_employee_points_transaction_v4(
      v_target.id,
      v_points,
      'تقييم أداء الدكتور من جانب خدمة العملاء',
      nullif(trim(coalesce(p_payload->>'notes','')),''),
      'doctor_customer_service_evaluation',
      v_id,
      null,
      to_char(v_month,'YYYY-MM'),
      coalesce(v_target.branch,''),
      'active',
      'تقييم خدمة العملاء للدكاترة',
      jsonb_build_object(
        'evaluation_score',v_score,
        'evaluation_month',v_month,
        'source_command','save_doctor_customer_service_evaluation_safe_v2'
      ),
      false
    );
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.save_doctor_customer_service_evaluation_safe(uuid,jsonb)
  from public,anon;
grant execute on function public.save_doctor_customer_service_evaluation_safe(uuid,jsonb)
  to authenticated,service_role;

comment on function public.save_doctor_customer_service_evaluation_safe(uuid,jsonb)
  is 'V2 monthly CS doctor evaluation: strict actor attribution, post-cycle finalization, payroll immutability, canonical points V4 write.';

notify pgrst,'reload schema';
