-- Reproduce the current production authorization boundary for monthly staff evaluations.
-- Production already contains these protections; this migration captures them in source control
-- so a rebuilt environment cannot regress to allowing evaluator == subject.

create or replace function public.monthly_eval_actor(p_actor_id uuid)
returns table(account_id uuid, staff_id uuid, role text, branch text, name text)
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select a.id,
         case when a.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.staff_id::uuid else null end,
         lower(coalesce(a.role,'')), coalesce(a.branch,''), coalesce(a.name,a.staff_name,a.username)
  from public.staff_accounts a
  where a.id=p_actor_id and coalesce(a.active,false)=true and coalesce(a.can_login,false)=true
  limit 1
$function$;

create or replace function public.list_staff_for_monthly_evaluation_safe(
  p_actor_id uuid,
  p_branch text default null::text
)
returns table(id uuid, name text, role text, branch text, status text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;

  return query
  select s.id, s.name, coalesce(s.role,s.type), coalesce(s.branch,''),
         coalesce(s.status, case when coalesce(s.active,s.is_active,true) then 'active' else 'inactive' end)
  from public.staff s
  where coalesce(s.active,s.is_active,true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|موقوف|غير نشط|archived')
    and coalesce(s.role,s.type,'') ~* 'pharmac|صيدل|دكتور|doctor|shift_supervisor|branch_manager|customer_service|خدمة العملاء'
    -- The evaluator must never appear in the subject picker.
    and (v_actor.staff_id is null or s.id <> v_actor.staff_id)
    and (
      v_actor.role in ('general_manager','branches_manager')
      or (
        v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
        and coalesce(s.branch,'')=v_actor.branch
        and coalesce(s.role,s.type,'') !~* 'branch_manager|customer_service|خدمة العملاء'
      )
    )
    and (
      p_branch is null
      or p_branch=''
      or coalesce(s.branch,'')=p_branch
      or v_actor.role not in ('general_manager','branches_manager')
    )
  order by s.name;
end
$function$;

create or replace function public.get_staff_monthly_evaluation_safe(
  p_actor_id uuid,
  p_staff_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_row public.staff_monthly_manager_evaluations%rowtype;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return null; end if;

  select * into v_target from public.staff where id=p_staff_id;
  if not found then return null; end if;

  if not (
    v_actor.role in ('general_manager','branches_manager')
    or (
      v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
      and coalesce(v_target.branch,'')=v_actor.branch
    )
    or (v_actor.staff_id=p_staff_id)
  ) then
    return null;
  end if;

  select * into v_row
  from public.staff_monthly_manager_evaluations
  where staff_id=p_staff_id and evaluation_month=p_month;
  if not found then return null; end if;

  if v_actor.staff_id=p_staff_id
     and v_actor.role not in ('general_manager','branches_manager','branch_manager','branch_manager_shamy','branch_manager_shokry')
     and v_row.status<>'sent' then
    return null;
  end if;

  return to_jsonb(v_row);
end
$function$;

create or replace function public.save_staff_monthly_evaluation_safe(
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
  v_staff_id uuid;
  v_month date;
  v_status text;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized'; end if;

  if v_actor.role not in ('general_manager','branches_manager','branch_manager','branch_manager_shamy','branch_manager_shokry') then
    raise exception 'not allowed';
  end if;

  v_staff_id := (p_payload->>'staff_id')::uuid;
  v_month := (p_payload->>'evaluation_month')::date;
  v_status := coalesce(nullif(p_payload->>'status',''),'draft');

  -- UI filtering is convenience only; enforce the rule at the write boundary too.
  if v_actor.staff_id is not null and v_staff_id = v_actor.staff_id then
    raise exception 'لا يمكن للموظف تقييم نفسه شهريًا';
  end if;

  select * into v_target from public.staff where id=v_staff_id;
  if not found then raise exception 'staff not found'; end if;

  if v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry') then
    if coalesce(v_target.branch,'')<>v_actor.branch then
      raise exception 'branch scope denied';
    end if;
    if coalesce(v_target.role,v_target.type,'') ~* 'branch_manager|customer_service|خدمة العملاء' then
      raise exception 'تقييم مسئولي خدمة العملاء ومديري الفروع يقتصر على مدير الفروع أو المدير العام';
    end if;
  end if;

  insert into public.staff_monthly_manager_evaluations(
    staff_id, staff_name, staff_role, branch, evaluation_month,
    evaluator_id, evaluator_name, evaluator_role, sections, metrics_snapshot,
    strengths, development_points, manager_notes, overall_score, grade,
    suggested_incentive, approved_incentive, points_delta, status, sent_at, updated_at
  ) values (
    v_staff_id,
    coalesce(p_payload->>'staff_name',v_target.name),
    p_payload->>'staff_role',
    coalesce(p_payload->>'branch',v_target.branch),
    v_month,
    p_actor_id,
    v_actor.name,
    v_actor.role,
    coalesce(p_payload->'sections','[]'::jsonb),
    coalesce(p_payload->'metrics_snapshot','{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'strengths','[]'::jsonb))),'{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'development_points','[]'::jsonb))),'{}'),
    p_payload->>'manager_notes',
    coalesce((p_payload->>'overall_score')::numeric,0),
    p_payload->>'grade',
    coalesce((p_payload->>'suggested_incentive')::numeric,0),
    coalesce((p_payload->>'approved_incentive')::numeric,0),
    coalesce((p_payload->>'points_delta')::numeric,0),
    v_status,
    case when v_status='sent' then now() else null end,
    now()
  )
  on conflict(staff_id,evaluation_month) do update set
    staff_name=excluded.staff_name,
    staff_role=excluded.staff_role,
    branch=excluded.branch,
    evaluator_id=excluded.evaluator_id,
    evaluator_name=excluded.evaluator_name,
    evaluator_role=excluded.evaluator_role,
    sections=excluded.sections,
    metrics_snapshot=excluded.metrics_snapshot,
    strengths=excluded.strengths,
    development_points=excluded.development_points,
    manager_notes=excluded.manager_notes,
    overall_score=excluded.overall_score,
    grade=excluded.grade,
    suggested_incentive=excluded.suggested_incentive,
    approved_incentive=excluded.approved_incentive,
    points_delta=excluded.points_delta,
    status=excluded.status,
    sent_at=case
      when excluded.status='sent' then coalesce(public.staff_monthly_manager_evaluations.sent_at,now())
      else public.staff_monthly_manager_evaluations.sent_at
    end,
    updated_at=now()
  returning id into v_id;

  return v_id;
end
$function$;

revoke all on function public.monthly_eval_actor(uuid) from public;
revoke all on function public.list_staff_for_monthly_evaluation_safe(uuid,text) from public;
revoke all on function public.get_staff_monthly_evaluation_safe(uuid,uuid,date) from public;
revoke all on function public.save_staff_monthly_evaluation_safe(uuid,jsonb) from public;

grant execute on function public.monthly_eval_actor(uuid) to anon, authenticated, service_role;
grant execute on function public.list_staff_for_monthly_evaluation_safe(uuid,text) to anon, authenticated, service_role;
grant execute on function public.get_staff_monthly_evaluation_safe(uuid,uuid,date) to anon, authenticated, service_role;
grant execute on function public.save_staff_monthly_evaluation_safe(uuid,jsonb) to anon, authenticated, service_role;
