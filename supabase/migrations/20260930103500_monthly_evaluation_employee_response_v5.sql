-- Monthly Evaluation V5: employee acknowledgement and one immutable comment.
-- Reuses staff_monthly_evaluation_audit; does not change scores, status, points, or incentives.

create or replace function public.respond_staff_monthly_evaluation_v5(
  p_actor_id uuid,
  p_staff_id uuid,
  p_month date,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_eval public.staff_monthly_manager_evaluations%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_comment text := nullif(trim(coalesce(p_comment,'')),'');
  v_existing_ack timestamptz;
  v_existing_comment text;
  v_audit_id uuid;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized'; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    raise exception 'actor_mismatch';
  end if;

  if v_actor.staff_id is null or v_actor.staff_id is distinct from p_staff_id then
    raise exception 'employee_response_self_only';
  end if;

  select * into v_target from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;

  select * into v_eval
  from public.staff_monthly_manager_evaluations
  where staff_id=p_staff_id and evaluation_month=v_month;

  if not found then raise exception 'evaluation_not_found'; end if;
  if coalesce(v_eval.status,'') not in ('sent','approved') then
    raise exception 'evaluation_not_published';
  end if;

  if v_action not in ('acknowledge','comment') then
    raise exception 'invalid_employee_response_action';
  end if;

  select min(a.created_at)
  into v_existing_ack
  from public.staff_monthly_evaluation_audit a
  where a.evaluation_id=v_eval.id
    and a.staff_id=p_staff_id
    and a.action='employee_acknowledged'
    and a.actor_id=v_actor.account_id;

  select nullif(trim(a.snapshot->>'comment'),'')
  into v_existing_comment
  from public.staff_monthly_evaluation_audit a
  where a.evaluation_id=v_eval.id
    and a.staff_id=p_staff_id
    and a.action='employee_comment'
    and a.actor_id=v_actor.account_id
  order by a.created_at asc
  limit 1;

  if v_action='acknowledge' then
    if v_existing_ack is not null then
      return jsonb_build_object(
        'ok',true,
        'action','employee_acknowledged',
        'already_recorded',true,
        'acknowledged_at',v_existing_ack,
        'comment',v_existing_comment
      );
    end if;

    insert into public.staff_monthly_evaluation_audit(
      evaluation_id,staff_id,evaluation_month,
      actor_id,actor_name,actor_role,action,
      status_before,status_after,score_before,score_after,
      evidence_ready,multiplier_pct,snapshot
    ) values (
      v_eval.id,p_staff_id,v_month,
      v_actor.account_id,v_actor.name,v_actor.role,'employee_acknowledged',
      v_eval.status,v_eval.status,v_eval.overall_score,v_eval.overall_score,
      coalesce(lower(v_eval.metrics_snapshot->>'evidence_ready') in ('true','t','1'),false),
      null,
      jsonb_build_object(
        'acknowledged',true,
        'evaluation_sent_at',v_eval.sent_at,
        'evaluation_updated_at',v_eval.updated_at
      )
    )
    returning id into v_audit_id;

    return jsonb_build_object(
      'ok',true,
      'action','employee_acknowledged',
      'already_recorded',false,
      'audit_id',v_audit_id,
      'acknowledged_at',now(),
      'comment',v_existing_comment
    );
  end if;

  if v_comment is null then raise exception 'employee_comment_required'; end if;
  if char_length(v_comment) < 3 then raise exception 'employee_comment_too_short'; end if;
  if char_length(v_comment) > 1000 then raise exception 'employee_comment_too_long'; end if;
  if v_existing_comment is not null then raise exception 'employee_comment_already_submitted'; end if;

  insert into public.staff_monthly_evaluation_audit(
    evaluation_id,staff_id,evaluation_month,
    actor_id,actor_name,actor_role,action,
    status_before,status_after,score_before,score_after,
    evidence_ready,multiplier_pct,snapshot
  ) values (
    v_eval.id,p_staff_id,v_month,
    v_actor.account_id,v_actor.name,v_actor.role,'employee_comment',
    v_eval.status,v_eval.status,v_eval.overall_score,v_eval.overall_score,
    coalesce(lower(v_eval.metrics_snapshot->>'evidence_ready') in ('true','t','1'),false),
    null,
    jsonb_build_object(
      'comment',v_comment,
      'evaluation_sent_at',v_eval.sent_at,
      'evaluation_updated_at',v_eval.updated_at
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok',true,
    'action','employee_comment',
    'audit_id',v_audit_id,
    'acknowledged_at',v_existing_ack,
    'comment',v_comment
  );
end;
$function$;

create or replace function public.get_staff_monthly_evaluation_employee_response_v5(
  p_actor_id uuid,
  p_staff_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_eval public.staff_monthly_manager_evaluations%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_ack_at timestamptz;
  v_comment text;
  v_comment_at timestamptz;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return null; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    return null;
  end if;

  select * into v_target from public.staff where id=p_staff_id;
  if not found then return null; end if;

  select * into v_eval
  from public.staff_monthly_manager_evaluations
  where staff_id=p_staff_id and evaluation_month=v_month;

  if not found or coalesce(v_eval.status,'') not in ('sent','approved') then
    return null;
  end if;

  if not (
    v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
    or (
      v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
      and coalesce(v_target.branch,'')=v_actor.branch
      and coalesce(v_target.role,v_target.type,'') !~* 'branch_manager|customer_service|خدمة العملاء'
    )
    or v_actor.staff_id=p_staff_id
  ) then
    return null;
  end if;

  select min(a.created_at)
  into v_ack_at
  from public.staff_monthly_evaluation_audit a
  where a.evaluation_id=v_eval.id
    and a.staff_id=p_staff_id
    and a.action='employee_acknowledged';

  select a.snapshot->>'comment', a.created_at
  into v_comment, v_comment_at
  from public.staff_monthly_evaluation_audit a
  where a.evaluation_id=v_eval.id
    and a.staff_id=p_staff_id
    and a.action='employee_comment'
  order by a.created_at asc
  limit 1;

  return jsonb_build_object(
    'evaluation_id',v_eval.id,
    'acknowledged',v_ack_at is not null,
    'acknowledged_at',v_ack_at,
    'comment',v_comment,
    'commented_at',v_comment_at
  );
end;
$function$;

revoke all on function public.respond_staff_monthly_evaluation_v5(uuid,uuid,date,text,text) from public;
revoke all on function public.get_staff_monthly_evaluation_employee_response_v5(uuid,uuid,date) from public;

grant execute on function public.respond_staff_monthly_evaluation_v5(uuid,uuid,date,text,text) to anon, authenticated;
grant execute on function public.get_staff_monthly_evaluation_employee_response_v5(uuid,uuid,date) to anon, authenticated;


create or replace function public.list_staff_monthly_evaluation_response_status_v5(
  p_actor_id uuid,
  p_branch text default null,
  p_month date default null
)
returns table(
  staff_id uuid,
  acknowledged_at timestamptz,
  commented_at timestamptz
)
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_month date := date_trunc('month', coalesce(p_month,current_date))::date;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    return;
  end if;

  if v_actor.role not in (
    'general_manager','branches_manager','executive_manager','executive','admin',
    'branch_manager','branch_manager_shamy','branch_manager_shokry'
  ) then
    return;
  end if;

  return query
  select
    e.staff_id,
    min(a.created_at) filter (where a.action='employee_acknowledged') as acknowledged_at,
    min(a.created_at) filter (where a.action='employee_comment') as commented_at
  from public.staff_monthly_manager_evaluations e
  join public.staff s on s.id=e.staff_id
  left join public.staff_monthly_evaluation_audit a
    on a.evaluation_id=e.id
   and a.staff_id=e.staff_id
   and a.action in ('employee_acknowledged','employee_comment')
  where e.evaluation_month=v_month
    and e.status in ('sent','approved')
    and (
      v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
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
      or v_actor.role not in ('general_manager','branches_manager','executive_manager','executive','admin')
    )
  group by e.staff_id;
end;
$function$;

revoke all on function public.list_staff_monthly_evaluation_response_status_v5(uuid,text,date) from public;
grant execute on function public.list_staff_monthly_evaluation_response_status_v5(uuid,text,date) to anon, authenticated;
