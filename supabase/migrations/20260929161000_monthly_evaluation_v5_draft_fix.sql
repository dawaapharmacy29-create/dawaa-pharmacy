-- Allow partial monthly-evaluation drafts while keeping final approval strict.
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

  if coalesce(v_target.role,v_target.type,'') !~* 'pharmac|صيدل|دكتور|doctor|assistant|مساعد|inventory|مخزون|delivery|دليفري|cleaning|نظاف|purchasing|مشتريات|shift_supervisor|branch_manager|customer_service|خدمة العملاء|فريق دواء' then
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
    and (x->>'score')::numeric between 0 and 5
    and (x->>'weight')::numeric > 0;

  if v_section_count <> jsonb_array_length(v_sections) then
    raise exception 'محاور التقييم يجب أن تحمل درجة صحيحة من 0 إلى 5 ووزنًا موجبًا';
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

  if v_status='sent' and (now() at time zone 'Africa/Cairo')::date <= v_cycle_end then
    raise exception 'لا يمكن الاعتماد النهائي قبل إقفال الدورة يوم 25';
  end if;

  if v_status='sent' and not v_evidence_ready then
    raise exception 'لا يمكن الاعتماد النهائي قبل اكتمال مصادر الأدلة';
  end if;

  if v_status='sent' and exists (
    select 1
    from jsonb_array_elements(v_sections) x
    where (x->>'score')::numeric = 0
  ) then
    raise exception 'يجب تقييم كل المحاور قبل الاعتماد النهائي';
  end if;

  if v_status='sent' and exists (
    select 1
    from jsonb_array_elements(v_sections) x
    where (x->>'score')::numeric <= 2
      and btrim(coalesce(x->>'notes','')) = ''
  ) then
    raise exception 'أي محور بدرجة 1 أو 2 نجمة يحتاج سببًا مكتوبًا قبل الاعتماد';
  end if;

  select * into v_existing
  from public.staff_monthly_manager_evaluations
  where staff_id=v_staff_id and evaluation_month=v_month;

  if found and v_existing.status in ('sent','approved') and v_status='draft' then
    raise exception 'التقييم المعتمد لا يعود لمسودة؛ استخدم إعادة الاعتماد بعد المراجعة';
  end if;

  v_gates := coalesce(v_metrics->'active_critical_gates','[]'::jsonb);
  if jsonb_typeof(v_gates) <> 'array' then
    v_gates := '[]'::jsonb;
  end if;

  if v_status='sent'
     and jsonb_array_length(v_gates) > 0
     and btrim(coalesce(p_payload->>'manager_notes','')) = '' then
    raise exception 'تفعيل مخالفة حرجة يحتاج ملاحظة مدير توضح سبب القرار قبل الاعتماد';
  end if;

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
