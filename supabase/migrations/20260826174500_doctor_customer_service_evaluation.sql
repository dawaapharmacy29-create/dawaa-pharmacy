-- Dedicated customer-service evaluation path for doctors.
-- Keeps this assessment separate from the generic manager monthly evaluation,
-- while settling its approved score into the canonical employee points ledger.

create table if not exists public.doctor_customer_service_evaluations (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.staff(id) on delete cascade,
  doctor_name text not null,
  branch text not null,
  evaluation_month date not null,
  evaluator_id uuid not null,
  evaluator_name text,
  evaluator_role text,
  sections jsonb not null default '[]'::jsonb,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  overall_score numeric not null default 0,
  points_delta numeric not null default 0,
  notes text,
  status text not null default 'draft',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, evaluation_month)
);

alter table public.doctor_customer_service_evaluations enable row level security;
revoke all on table public.doctor_customer_service_evaluations from anon, authenticated;

create or replace function public.list_doctors_for_customer_service_evaluation_safe(p_actor_id uuid)
returns table(id uuid, name text, role text, branch text, status text)
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;
  if v_actor.role not in ('customer_service_manager','general_manager','branches_manager') then
    raise exception 'not allowed';
  end if;

  return query
  select
    s.id,
    s.name,
    coalesce(s.role,s.type),
    coalesce(s.branch,''),
    coalesce(s.status,'active')
  from public.staff s
  where coalesce(s.active,s.is_active,true)=true
    and coalesce(s.status,'') !~* 'inactive|disabled|موقوف|غير نشط|archived'
    and coalesce(s.role,s.type,'') ~* 'pharmac|صيدل|دكتور|doctor'
    and coalesce(s.role,s.type,'') !~* 'branch_manager|customer_service|خدمة العملاء|assistant|مساعد|clean'
    and (v_actor.role in ('general_manager','branches_manager') or coalesce(s.branch,'')=v_actor.branch)
  order by s.name;
end
$function$;

create or replace function public.get_doctor_customer_service_evaluation_safe(
  p_actor_id uuid,
  p_doctor_id uuid,
  p_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_row record;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized'; end if;
  if v_actor.role not in ('customer_service_manager','general_manager','branches_manager') then
    raise exception 'not allowed';
  end if;

  select * into v_target from public.staff where id=p_doctor_id;
  if not found then raise exception 'doctor not found'; end if;
  if v_actor.role='customer_service_manager' and coalesce(v_target.branch,'')<>v_actor.branch then
    raise exception 'branch scope denied';
  end if;

  select * into v_row
  from public.doctor_customer_service_evaluations
  where doctor_id=p_doctor_id and evaluation_month=p_month
  limit 1;

  if not found then return null; end if;
  return to_jsonb(v_row);
end
$function$;

create or replace function public.save_doctor_customer_service_evaluation_safe(
  p_actor_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_id uuid;
  v_month date;
  v_score numeric;
  v_points numeric;
  v_status text;
  v_existing_transaction uuid;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized'; end if;
  if v_actor.role not in ('customer_service_manager','general_manager','branches_manager') then
    raise exception 'not allowed';
  end if;

  select * into v_target
  from public.staff
  where id=(p_payload->>'doctor_id')::uuid;
  if not found then raise exception 'doctor not found'; end if;

  if coalesce(v_target.role,v_target.type,'') !~* 'pharmac|صيدل|دكتور|doctor'
     or coalesce(v_target.role,v_target.type,'') ~* 'branch_manager|customer_service|خدمة العملاء|assistant|مساعد|clean' then
    raise exception 'target must be doctor';
  end if;

  if v_actor.role='customer_service_manager' and coalesce(v_target.branch,'')<>v_actor.branch then
    raise exception 'branch scope denied';
  end if;

  v_month := (p_payload->>'evaluation_month')::date;
  v_score := greatest(0,least(100,coalesce((p_payload->>'overall_score')::numeric,0)));
  v_status := coalesce(nullif(p_payload->>'status',''),'draft');
  v_points := case
    when v_score>=95 then 20
    when v_score>=90 then 10
    when v_score>=80 then 5
    when v_score>=70 then 0
    when v_score>=60 then -5
    else -10
  end;

  insert into public.doctor_customer_service_evaluations(
    doctor_id, doctor_name, branch, evaluation_month,
    evaluator_id, evaluator_name, evaluator_role,
    sections, metrics_snapshot, overall_score, points_delta,
    notes, status, sent_at, updated_at
  ) values (
    v_target.id,
    v_target.name,
    coalesce(v_target.branch,''),
    v_month,
    p_actor_id,
    v_actor.name,
    v_actor.role,
    coalesce(p_payload->'sections','[]'::jsonb),
    coalesce(p_payload->'metrics_snapshot','{}'::jsonb),
    v_score,
    v_points,
    p_payload->>'notes',
    v_status,
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
      when excluded.status in ('sent','approved') then coalesce(public.doctor_customer_service_evaluations.sent_at,now())
      else public.doctor_customer_service_evaluations.sent_at
    end,
    updated_at=now()
  returning id into v_id;

  select id into v_existing_transaction
  from public.employee_transactions
  where source='doctor_customer_service_evaluation' and source_id=v_id
  limit 1;

  if v_status in ('sent','approved') then
    if v_existing_transaction is null then
      insert into public.employee_transactions(
        staff_id, type, points, points_delta, amount, reason,
        source, source_id, month_cycle, branch, status,
        employee_name, created_by, description, category, employee_visible
      ) values (
        v_target.id,
        case when v_points<0 then 'penalty' else 'reward' end,
        abs(v_points),
        v_points,
        0,
        'تقييم أداء الدكتور من جانب خدمة العملاء',
        'doctor_customer_service_evaluation',
        v_id,
        to_char(v_month,'YYYY-MM'),
        coalesce(v_target.branch,''),
        'active',
        v_target.name,
        p_actor_id::text,
        coalesce(p_payload->>'notes',''),
        'تقييم خدمة العملاء للدكاترة',
        true
      );
    else
      update public.employee_transactions set
        type=case when v_points<0 then 'penalty' else 'reward' end,
        points=abs(v_points),
        points_delta=v_points,
        amount=0,
        reason='تقييم أداء الدكتور من جانب خدمة العملاء',
        description=coalesce(p_payload->>'notes',''),
        status='active',
        updated_at=now()
      where id=v_existing_transaction;
    end if;
  elsif v_existing_transaction is not null then
    update public.employee_transactions
    set status='inactive', updated_at=now()
    where id=v_existing_transaction;
  end if;

  perform public.dawaa_refresh_staff_points_snapshot_v1(v_target.id);
  return v_id;
end
$function$;

grant execute on function public.list_doctors_for_customer_service_evaluation_safe(uuid) to authenticated;
grant execute on function public.get_doctor_customer_service_evaluation_safe(uuid,uuid,date) to authenticated;
grant execute on function public.save_doctor_customer_service_evaluation_safe(uuid,jsonb) to authenticated;
