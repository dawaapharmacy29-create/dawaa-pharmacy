-- Monthly Evaluation Command Center V5
-- Safe monthly evaluation workflow, status directory, and immutable audit trail.

create table if not exists public.staff_monthly_evaluation_audit (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.staff_monthly_manager_evaluations(id),
  staff_id uuid not null,
  evaluation_month date not null,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text not null,
  status_before text,
  status_after text,
  score_before numeric,
  score_after numeric,
  evidence_ready boolean not null default false,
  multiplier_pct numeric,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_monthly_eval_audit_staff_month_idx
  on public.staff_monthly_evaluation_audit(staff_id, evaluation_month, created_at desc);

create index if not exists staff_monthly_eval_audit_evaluation_idx
  on public.staff_monthly_evaluation_audit(evaluation_id, created_at desc);

alter table public.staff_monthly_evaluation_audit enable row level security;
revoke all on table public.staff_monthly_evaluation_audit from anon, authenticated;

create or replace function public.list_staff_for_monthly_evaluation_v5(
  p_actor_id uuid,
  p_branch text default null,
  p_month date default null
)
returns table(
  id uuid,
  name text,
  role text,
  branch text,
  staff_status text,
  evaluation_status text,
  evaluation_score numeric,
  sent_at timestamptz,
  evidence_ready boolean
)
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_cycle_end date := (date_trunc('month', coalesce(p_month, current_date))::date + interval '24 days')::date;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then
    return;
  end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    return;
  end if;

  return query
  select
    s.id,
    s.name,
    coalesce(s.role, s.type),
    coalesce(s.branch, ''),
    coalesce(s.status, case when coalesce(s.active, s.is_active, true) then 'active' else 'inactive' end),
    case
      when e.id is null then 'not_started'
      when e.status in ('sent','approved')
        and (e.sent_at is null or e.sent_at::date <= v_cycle_end) then 'needs_reapproval'
      else e.status
    end,
    case when e.id is null then null else e.overall_score end,
    e.sent_at,
    coalesce(lower(e.metrics_snapshot->>'evidence_ready') in ('true','t','1'), false)
  from public.staff s
  left join public.staff_monthly_manager_evaluations e
    on e.staff_id = s.id
   and e.evaluation_month = v_month
  where coalesce(s.active, s.is_active, true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|موقوف|غير نشط|archived')
    and coalesce(s.role,s.type,'') ~* 'pharmac|صيدل|دكتور|doctor|shift_supervisor|branch_manager|customer_service|خدمة العملاء|فريق دواء'
    and (
      v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
      or (
        v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
        and coalesce(s.branch,'') = v_actor.branch
        and coalesce(s.role,s.type,'') !~* 'branch_manager|customer_service|خدمة العملاء'
      )
      or (v_actor.staff_id is not null and s.id = v_actor.staff_id)
    )
    and (
      p_branch is null
      or p_branch = ''
      or coalesce(s.branch,'') = p_branch
      or v_actor.role not in ('general_manager','branches_manager','executive_manager','executive','admin')
    )
  order by
    case
      when e.id is null then 0
      when e.status='draft' then 1
      when e.status in ('sent','approved') and (e.sent_at is null or e.sent_at::date <= v_cycle_end) then 2
      else 3
    end,
    s.name;
end;
$function$;

create or replace function public.save_staff_monthly_evaluation_v5(
  p_actor_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_existing public.staff_monthly_manager_evaluations%rowtype;
  v_id uuid;
  v_staff_id uuid;
  v_month date;
  v_cycle_end date;
  v_status text;
  v_sections jsonb;
  v_metrics jsonb;
  v_gates jsonb;
  v_section_count int := 0;
  v_weight_total numeric := 0;
  v_score numeric := 0;
  v_grade text;
  v_evidence_ready boolean := false;
  v_gate_cap numeric := 100;
  v_multiplier numeric := 100;
  v_action text;
  v_sent_at timestamptz;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then raise exception 'unauthorized'; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    raise exception 'actor_mismatch';
  end if;

  if v_actor.role not in (
    'general_manager','branches_manager','executive_manager','executive','admin',
    'branch_manager','branch_manager_shamy','branch_manager_shokry'
  ) then
    raise exception 'not_allowed';
  end if;

  v_staff_id := nullif(p_payload->>'staff_id','')::uuid;
  if v_staff_id is null then raise exception 'staff_id_required'; end if;

  v_month := date_trunc('month', nullif(p_payload->>'evaluation_month','')::date)::date;
  if v_month is null then raise exception 'evaluation_month_required'; end if;
  v_cycle_end := (v_month + interval '24 days')::date;

  v_status := lower(coalesce(nullif(p_payload->>'status',''),'draft'));
  if v_status not in ('draft','sent') then raise exception 'invalid_status'; end if;

  select * into v_target from public.staff where id=v_staff_id;
  if not found then raise exception 'staff_not_found'; end if;

  if v_actor.staff_id is not null and v_staff_id = v_actor.staff_id then
    raise exception 'لا يمكن للموظف تقييم نفسه شهريًا';
  end if;

  if coalesce(v_target.active, v_target.is_active, true) = false
     or coalesce(v_target.status,'') ~* 'inactive|disabled|موقوف|غير نشط|archived' then
    raise exception 'inactive_staff_cannot_be_evaluated';
  end if;

  if coalesce(v_target.role,v_target.type,'') !~* 'pharmac|صيدل|دكتور|doctor|shift_supervisor|branch_manager|customer_service|خدمة العملاء|فريق دواء' then
    raise exception 'unsupported_staff_role';
  end if;

  if v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry') then
    if coalesce(v_target.branch,'') <> v_actor.branch then raise exception 'branch_scope_denied'; end if;
    if coalesce(v_target.role,v_target.type,'') ~* 'branch_manager|customer_service|خدمة العملاء' then
      raise exception 'تقييم مسئولي خدمة العملاء ومديري الفروع يقتصر على مدير الفروع أو المدير العام';
    end if;
  end if;

  v_sections := coalesce(p_payload->'sections','[]'::jsonb);
  if jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections)=0 then
    raise exception 'evaluation_sections_required';
  end if;

  select
    count(*)::int,
    coalesce(sum((x->>'weight')::numeric),0),
    round(coalesce(sum(((x->>'score')::numeric / 5.0) * (x->>'weight')::numeric),0),1)
  into v_section_count, v_weight_total, v_score
  from jsonb_array_elements(v_sections) x
  where (x->>'score') ~ '^[0-9]+([.][0-9]+)?$'
    and (x->>'weight') ~ '^[0-9]+([.][0-9]+)?$'
    and (x->>'score')::numeric between 1 and 5
    and (x->>'weight')::numeric > 0;

  if v_section_count <> jsonb_array_length(v_sections) then
    raise exception 'كل محاور التقييم يجب أن تحمل درجة صحيحة من 1 إلى 5 ووزنًا موجبًا';
  end if;

  if abs(v_weight_total - 100) > 0.01 then
    raise exception 'evaluation_weights_must_total_100';
  end if;

  v_score := greatest(0, least(100, v_score));
  v_grade := case
    when v_score >= 90 then 'ممتاز'
    when v_score >= 80 then 'جيد جدًا'
    when v_score >= 70 then 'جيد'
    when v_score >= 60 then 'مقبول'
    else 'يحتاج خطة تحسين'
  end;

  v_metrics := coalesce(p_payload->'metrics_snapshot','{}'::jsonb);
  v_evidence_ready := coalesce(lower(v_metrics->>'evidence_ready') in ('true','t','1'), false);

  if v_status='sent' and current_date <= v_cycle_end then
    raise exception 'لا يمكن الاعتماد النهائي قبل إقفال الدورة يوم 25';
  end if;

  if v_status='sent' and not v_evidence_ready then
    raise exception 'لا يمكن الاعتماد النهائي قبل اكتمال مصادر الأدلة';
  end if;

  select * into v_existing
  from public.staff_monthly_manager_evaluations
  where staff_id=v_staff_id and evaluation_month=v_month;

  if found and v_existing.status in ('sent','approved') and v_status='draft' then
    raise exception 'التقييم المعتمد لا يعود لمسودة؛ استخدم إعادة الاعتماد بعد المراجعة';
  end if;

  v_gates := coalesce(v_metrics->'active_critical_gates','[]'::jsonb);
  if jsonb_typeof(v_gates)='array' then
    select coalesce(min(
      case value
        when 'unexplained_cash_shortage' then 0
        when 'data_manipulation' then 0
        when 'ignored_serious_complaint' then 40
        when 'unescalated_critical_issue' then 60
        when 'repeated_negligence' then 70
        else 100
      end
    ),100)
    into v_gate_cap
    from jsonb_array_elements_text(v_gates);
  end if;

  v_multiplier := greatest(0, least(100, least(v_score, v_gate_cap)));

  v_metrics := v_metrics || jsonb_build_object(
    'evaluation_engine_version', 5,
    'server_overall_score', v_score,
    'server_grade', v_grade,
    'server_gate_cap_pct', v_gate_cap,
    'server_multiplier_pct', v_multiplier,
    'server_validated_at', now()
  );

  insert into public.staff_monthly_manager_evaluations(
    staff_id,staff_name,staff_role,branch,evaluation_month,
    evaluator_id,evaluator_name,evaluator_role,
    sections,metrics_snapshot,strengths,development_points,manager_notes,
    overall_score,grade,suggested_incentive,approved_incentive,points_delta,status,sent_at,updated_at
  ) values (
    v_staff_id,
    v_target.name,
    coalesce(v_target.role,v_target.type),
    coalesce(v_target.branch,''),
    v_month,
    v_actor.account_id,
    v_actor.name,
    v_actor.role,
    v_sections,
    v_metrics,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'strengths','[]'::jsonb))),'{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'development_points','[]'::jsonb))),'{}'),
    p_payload->>'manager_notes',
    v_score,
    v_grade,
    0,0,0,
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
    suggested_incentive=0,
    approved_incentive=0,
    points_delta=0,
    status=excluded.status,
    sent_at=case when excluded.status='sent' then now() else public.staff_monthly_manager_evaluations.sent_at end,
    updated_at=now()
  returning id, sent_at into v_id, v_sent_at;

  if v_status='sent' then
    insert into public.staff_evaluation_incentive_multipliers(
      staff_id,month_cycle,multiplier_pct,source_evaluation_id,updated_at
    ) values (
      v_staff_id,to_char(v_month,'YYYY-MM'),v_multiplier,v_id,now()
    )
    on conflict(staff_id,month_cycle) do update set
      multiplier_pct=excluded.multiplier_pct,
      source_evaluation_id=excluded.source_evaluation_id,
      updated_at=now();

    v_action := case
      when v_existing.id is null then 'approved'
      when v_existing.status in ('sent','approved') then 'reapproved'
      else 'approved'
    end;
  else
    v_action := case when v_existing.id is null then 'draft_created' else 'draft_updated' end;
  end if;

  insert into public.staff_monthly_evaluation_audit(
    evaluation_id,staff_id,evaluation_month,
    actor_id,actor_name,actor_role,action,
    status_before,status_after,score_before,score_after,
    evidence_ready,multiplier_pct,snapshot
  ) values (
    v_id,v_staff_id,v_month,
    v_actor.account_id,v_actor.name,v_actor.role,v_action,
    case when v_existing.id is null then null else v_existing.status end,
    v_status,
    case when v_existing.id is null then null else v_existing.overall_score end,
    v_score,
    v_evidence_ready,
    case when v_status='sent' then v_multiplier else null end,
    jsonb_build_object(
      'active_critical_gates', v_gates,
      'gate_cap_pct', v_gate_cap,
      'section_count', jsonb_array_length(v_sections),
      'evidence_health', v_metrics->'evidence_health'
    )
  );

  return jsonb_build_object(
    'evaluation_id',v_id,
    'status',v_status,
    'sent_at',v_sent_at,
    'overall_score',v_score,
    'grade',v_grade,
    'evidence_ready',v_evidence_ready,
    'multiplier_applied',v_status='sent',
    'multiplier_pct',case when v_status='sent' then v_multiplier else null end,
    'gate_cap_pct',v_gate_cap,
    'action',v_action,
    'engine_version',5
  );
end;
$function$;

create or replace function public.get_staff_monthly_evaluation_audit_v5(
  p_actor_id uuid,
  p_staff_id uuid,
  p_month date
)
returns table(
  id uuid,
  evaluation_id uuid,
  action text,
  actor_name text,
  actor_role text,
  status_before text,
  status_after text,
  score_before numeric,
  score_after numeric,
  evidence_ready boolean,
  multiplier_pct numeric,
  snapshot jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_month date := date_trunc('month', p_month)::date;
  v_eval_status text;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    return;
  end if;

  select * into v_target from public.staff where id=p_staff_id;
  if not found then return; end if;

  select e.status into v_eval_status
  from public.staff_monthly_manager_evaluations e
  where e.staff_id=p_staff_id and e.evaluation_month=v_month;

  if not (
    v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
    or (
      v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
      and coalesce(v_target.branch,'')=v_actor.branch
    )
    or (
      v_actor.staff_id=p_staff_id
      and coalesce(v_eval_status,'') in ('sent','approved')
    )
  ) then
    return;
  end if;

  return query
  select
    a.id,a.evaluation_id,a.action,a.actor_name,a.actor_role,
    a.status_before,a.status_after,a.score_before,a.score_after,
    a.evidence_ready,a.multiplier_pct,a.snapshot,a.created_at
  from public.staff_monthly_evaluation_audit a
  where a.staff_id=p_staff_id and a.evaluation_month=v_month
  order by a.created_at desc;
end;
$function$;

revoke all on function public.list_staff_for_monthly_evaluation_v5(uuid,text,date) from public;
revoke all on function public.save_staff_monthly_evaluation_v5(uuid,jsonb) from public;
revoke all on function public.get_staff_monthly_evaluation_audit_v5(uuid,uuid,date) from public;

grant execute on function public.list_staff_for_monthly_evaluation_v5(uuid,text,date) to anon, authenticated;
grant execute on function public.save_staff_monthly_evaluation_v5(uuid,jsonb) to anon, authenticated;
grant execute on function public.get_staff_monthly_evaluation_audit_v5(uuid,uuid,date) to anon, authenticated;
