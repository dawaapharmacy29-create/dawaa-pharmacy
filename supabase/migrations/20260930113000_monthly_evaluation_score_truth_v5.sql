-- Monthly Evaluation V5 score/incentive truth hardening.
-- 1) The server, not the browser, owns the role profile section keys and weights.
-- 2) The stored score/grade are recomputed from the canonical profile on every V5 write.
-- 3) Critical-gate keys are whitelisted and remain multiplier-only: they never create points DML.
-- 4) Legacy monthly_evaluation_critical_gate point penalties are cancelled only for mutable
--    (non-payroll-finalized) cycles, then blocked from being reintroduced.

create or replace function public.dawaa_monthly_evaluation_canonical_role_v5(p_role text)
returns text
language plpgsql
immutable
set search_path to 'public','pg_catalog'
as $function$
declare
  v_role text := lower(trim(coalesce(p_role,'')));
begin
  v_role := regexp_replace(v_role,'[_-]+',' ','g');
  v_role := regexp_replace(v_role,'[[:space:]]+',' ','g');

  if v_role in ('صيدلاني','صيدلي','دكتور','doctor','pharmacist') then return 'doctor'; end if;
  if v_role in ('مساعد صيدلي','assistant','pharmacy assistant') then return 'assistant'; end if;
  if v_role='inventory assistant' or v_role like '%مساعد مخزن%' or v_role like '%مساعد جرد%' then return 'inventory_assistant'; end if;
  if v_role like '%نظاف%' or v_role in ('cleaning','cleaner','cleaning supervisor') then return 'cleaning'; end if;
  if v_role in ('توصيل','دليفري','delivery','rider') then return 'delivery'; end if;
  if v_role in ('خدمة عملاء','مسؤول خدمة العملاء','مسؤولة خدمة العملاء','customer service') then return 'customer_service'; end if;
  if v_role in ('مدير خدمة العملاء','مديرة خدمة العملاء','customer service manager') then return 'customer_service_manager'; end if;
  if v_role in ('مسؤول الشيفت','مسئول الشيفت','shift supervisor') then return 'shift_supervisor'; end if;
  if v_role in ('مدير فرع','مديرة فرع','branch manager') then return 'branch_manager'; end if;
  if v_role in ('مدير الفروع','مديرة الفروع','branches manager') then return 'branches_manager'; end if;
  if v_role like '%مشتريات%' or v_role in ('purchasing','purchasing manager') then return 'purchasing'; end if;
  if v_role in ('مدير تنفيذي','مدير عام','executive manager','general manager') then return 'executive'; end if;
  if v_role in ('admin','أدمن','owner') then return 'admin'; end if;
  return 'other';
end;
$function$;

create or replace function public.trg_monthly_evaluation_profile_contract_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_engine integer := 0;
  v_role text;
  v_snapshot_role text;
  v_expected jsonb;
  v_expected_count integer := 0;
  v_actual_count integer := 0;
  v_distinct_count integer := 0;
  v_item jsonb;
  v_key text;
  v_weight numeric;
  v_score numeric;
  v_overall numeric := 0;
  v_grade text;
  v_gates jsonb;
  v_gate_count integer := 0;
  v_gate_distinct_count integer := 0;
  v_invalid_gate_count integer := 0;
begin
  if coalesce(new.metrics_snapshot->>'evaluation_engine_version','') ~ '^[0-9]+$' then
    v_engine := (new.metrics_snapshot->>'evaluation_engine_version')::integer;
  end if;
  if v_engine < 5 then
    return new;
  end if;

  v_role := public.dawaa_monthly_evaluation_canonical_role_v5(new.staff_role);
  v_snapshot_role := nullif(trim(coalesce(new.metrics_snapshot->>'canonical_role','')),'');

  if v_snapshot_role is not null and v_snapshot_role is distinct from v_role then
    raise exception 'monthly_evaluation_canonical_role_mismatch'
      using errcode='22023',
            detail=format('server=%s snapshot=%s',v_role,v_snapshot_role);
  end if;

  v_expected := case v_role
    when 'doctor' then '{"discipline":15,"conversations":20,"dispensing":20,"followups_requests":15,"sales_quality":10,"inventory":10,"development":10}'::jsonb
    when 'assistant' then '{"discipline":15,"orders_accuracy":25,"inventory":20,"shelf":15,"delivery_support":10,"teamwork":5,"development":10}'::jsonb
    when 'inventory_assistant' then '{"discipline":15,"inventory_accuracy":30,"shortages":20,"expiry":15,"documentation":10,"development":10}'::jsonb
    when 'cleaning' then '{"daily_stars":35,"checklist":25,"sensitive_areas":20,"response":10,"development":10}'::jsonb
    when 'delivery' then '{"attendance":15,"delivery_success":25,"timing":20,"customer":15,"data":15,"development":10}'::jsonb
    when 'customer_service' then '{"followups":30,"conversation":20,"data_quality":20,"requests":15,"discipline":5,"development":10}'::jsonb
    when 'customer_service_manager' then '{"team_quality":25,"followups_sla":25,"customer_outcomes":20,"data_governance":15,"leadership":5,"development":10}'::jsonb
    when 'shift_supervisor' then '{"shift_discipline":25,"handover":20,"team_execution":20,"customer_issues":15,"operations":10,"development":10}'::jsonb
    when 'branch_manager' then '{"team":25,"operations":20,"customers":20,"quality":15,"execution":10,"development":10}'::jsonb
    when 'branches_manager' then '{"branch_health":25,"managers":20,"operations":20,"customers":15,"execution":10,"development":10}'::jsonb
    when 'purchasing' then '{"availability":25,"purchase_accuracy":25,"customer_requests":20,"inventory":15,"coordination":5,"development":10}'::jsonb
    when 'executive' then '{"results":25,"governance":20,"leaders":20,"customers":15,"projects":10,"development":10}'::jsonb
    when 'admin' then '{"governance":30,"operations":25,"data":20,"execution":15,"development":10}'::jsonb
    else '{"discipline":30,"quality":30,"teamwork":20,"initiative":10,"development":10}'::jsonb
  end;

  if jsonb_typeof(new.sections) <> 'array' then
    raise exception 'monthly_evaluation_sections_must_be_array' using errcode='22023';
  end if;

  select count(*) into v_expected_count from jsonb_object_keys(v_expected);
  select count(*),count(distinct value->>'key')
    into v_actual_count,v_distinct_count
  from jsonb_array_elements(new.sections);

  if v_actual_count <> v_expected_count or v_distinct_count <> v_expected_count then
    raise exception 'monthly_evaluation_profile_section_set_mismatch'
      using errcode='22023',
            detail=format('role=%s expected=%s actual=%s distinct=%s',v_role,v_expected_count,v_actual_count,v_distinct_count);
  end if;

  for v_item in select value from jsonb_array_elements(new.sections)
  loop
    v_key := nullif(trim(coalesce(v_item->>'key','')),'');
    if v_key is null or not (v_expected ? v_key) then
      raise exception 'monthly_evaluation_unknown_section:%',coalesce(v_key,'(blank)') using errcode='22023';
    end if;

    if coalesce(v_item->>'weight','') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'monthly_evaluation_invalid_section_weight:%',v_key using errcode='22023';
    end if;
    v_weight := (v_item->>'weight')::numeric;
    if abs(v_weight - (v_expected->>v_key)::numeric) > 0.001 then
      raise exception 'monthly_evaluation_canonical_weight_mismatch:%',v_key
        using errcode='22023',
              detail=format('expected=%s actual=%s',(v_expected->>v_key),v_weight);
    end if;

    if coalesce(v_item->>'score','') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'monthly_evaluation_invalid_section_score:%',v_key using errcode='22023';
    end if;
    v_score := (v_item->>'score')::numeric;
    if v_score < 0 or v_score > 5 then
      raise exception 'monthly_evaluation_section_score_out_of_range:%',v_key using errcode='22023';
    end if;
    if v_score <> trunc(v_score) then
      raise exception 'monthly_evaluation_section_score_must_be_integer_star:%',v_key
        using errcode='22023',
              detail='V5 section scores are discrete stars: 0,1,2,3,4,5.';
    end if;

    if new.status in ('sent','approved') and v_score = 0 then
      raise exception 'يجب تقييم كل المحاور قبل الاعتماد النهائي';
    end if;
    if new.status in ('sent','approved') and v_score <= 2 and btrim(coalesce(v_item->>'notes',''))='' then
      raise exception 'أي محور بدرجة 1 أو 2 نجمة يحتاج سببًا مكتوبًا قبل الاعتماد';
    end if;

    v_overall := v_overall + ((v_score / 5.0) * (v_expected->>v_key)::numeric);
  end loop;

  v_overall := round(greatest(0,least(100,v_overall)),1);
  v_grade := case
    when v_overall >= 90 then 'ممتاز'
    when v_overall >= 80 then 'جيد جدًا'
    when v_overall >= 70 then 'جيد'
    when v_overall >= 60 then 'مقبول'
    else 'يحتاج خطة تحسين'
  end;

  v_gates := coalesce(new.metrics_snapshot->'active_critical_gates','[]'::jsonb);
  if jsonb_typeof(v_gates) <> 'array' then
    raise exception 'monthly_evaluation_critical_gates_must_be_array' using errcode='22023';
  end if;

  select
    count(*),
    count(distinct value),
    count(*) filter (
      where value not in (
        'unexplained_cash_shortage',
        'data_manipulation',
        'ignored_serious_complaint',
        'unescalated_critical_issue',
        'repeated_negligence'
      )
    )
  into v_gate_count,v_gate_distinct_count,v_invalid_gate_count
  from jsonb_array_elements_text(v_gates);

  if v_invalid_gate_count > 0 then
    raise exception 'invalid_monthly_evaluation_critical_gate' using errcode='22023';
  end if;
  if v_gate_count <> v_gate_distinct_count then
    raise exception 'duplicate_monthly_evaluation_critical_gate' using errcode='22023';
  end if;
  if new.status in ('sent','approved') and v_gate_count > 0 and btrim(coalesce(new.manager_notes,''))='' then
    raise exception 'تفعيل مخالفة حرجة يحتاج ملاحظة مدير توضح سبب القرار قبل الاعتماد';
  end if;

  -- V5 monthly evaluation never writes money or points directly.
  new.overall_score := v_overall;
  new.grade := v_grade;
  new.suggested_incentive := 0;
  new.approved_incentive := 0;
  new.points_delta := 0;
  new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'canonical_role',v_role,
      'server_profile_contract_version',5,
      'server_overall_score',v_overall,
      'server_grade',v_grade
    );

  return new;
end;
$function$;

drop trigger if exists monthly_evaluation_profile_contract_v5
  on public.staff_monthly_manager_evaluations;

create trigger monthly_evaluation_profile_contract_v5
before insert or update of sections,staff_role,metrics_snapshot,status,manager_notes
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_evaluation_profile_contract_v5();

-- Retire the old "gate = fixed points penalty" representation only while payroll is mutable.
-- Finalized payroll snapshots are intentionally untouched.
update public.employee_transactions t
set
  status='cancelled',
  updated_at=now(),
  metadata=coalesce(t.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'cancel_reason','replaced_by_monthly_evaluation_multiplier_v5',
      'cancelled_by_migration','20260930113000_monthly_evaluation_score_truth_v5'
    )
where t.source='monthly_evaluation_critical_gate'
  and coalesce(t.status,'active') in ('active','approved','pending')
  and t.month_cycle ~ '^[0-9]{4}-[0-9]{2}$'
  and not exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=t.staff_id
      and f.month_cycle=t.month_cycle
  );

create or replace function public.trg_block_legacy_monthly_gate_points_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if new.source='monthly_evaluation_critical_gate'
     and coalesce(new.status,'active') not in ('cancelled','reversed') then
    raise exception 'legacy_monthly_evaluation_critical_gate_points_retired'
      using errcode='55000',
            detail='Critical gates are represented only by the evaluation incentive multiplier in V5.';
  end if;
  return new;
end;
$function$;

drop trigger if exists block_legacy_monthly_gate_points_v5
  on public.employee_transactions;

create trigger block_legacy_monthly_gate_points_v5
before insert or update of source,status,points,points_delta
on public.employee_transactions
for each row
execute function public.trg_block_legacy_monthly_gate_points_v5();

revoke all on function public.dawaa_monthly_evaluation_canonical_role_v5(text)
  from public,anon,authenticated;
revoke all on function public.trg_monthly_evaluation_profile_contract_v5()
  from public,anon,authenticated;
revoke all on function public.trg_block_legacy_monthly_gate_points_v5()
  from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_canonical_role_v5(text)
  to service_role;
grant execute on function public.trg_monthly_evaluation_profile_contract_v5()
  to service_role;
grant execute on function public.trg_block_legacy_monthly_gate_points_v5()
  to service_role;

comment on function public.trg_monthly_evaluation_profile_contract_v5()
  is 'V5 monthly evaluation truth guard: canonical role/profile weights, server score/grade, critical-gate whitelist, and zero direct points/money.';
comment on function public.trg_block_legacy_monthly_gate_points_v5()
  is 'Blocks retired fixed-points representation of monthly critical gates; V5 uses multiplier-only gates.';

create or replace function public.dawaa_monthly_evaluation_server_evidence_v5(
  p_staff_id uuid,
  p_evaluation_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle_start date := (date_trunc('month',p_evaluation_month)::date - interval '1 month' + interval '25 days')::date;
  v_cycle_end_exclusive date := (date_trunc('month',p_evaluation_month)::date + interval '25 days')::date;
  v_reviews_available boolean := true;
  v_followups_available boolean := true;
  v_attendance_available boolean := true;
  v_review_count integer := 0;
  v_followup_count integer := 0;
  v_legacy_attendance_count integer := 0;
  v_modern_attendance_days integer := 0;
  v_errors jsonb := '{}'::jsonb;
begin
  begin
    select count(distinct r.id)::int
    into v_review_count
    from public.conversation_sales_reviews r
    where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
      and (
        (
          r.conversation_date is not null
          and r.conversation_date::date >= v_cycle_start
          and r.conversation_date::date < v_cycle_end_exclusive
        )
        or
        (
          r.conversation_date is null
          and (r.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
          and (r.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive
        )
      );
  exception when others then
    v_reviews_available := false;
    v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
  end;

  begin
    select count(*)::int
    into v_followup_count
    from public.daily_followups f
    where (f.assigned_staff_id=p_staff_id or f.requested_by_staff_id=p_staff_id)
      and (f.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
      and (f.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
  exception when others then
    v_followups_available := false;
    v_errors := v_errors || jsonb_build_object('followups',sqlerrm);
  end;

  begin
    select count(*)::int
    into v_legacy_attendance_count
    from public.attendance a
    where a.staff_id=p_staff_id
      and coalesce(
        nullif(a.attendance_date::text,'')::date,
        nullif(a.date::text,'')::date
      ) >= v_cycle_start
      and coalesce(
        nullif(a.attendance_date::text,'')::date,
        nullif(a.date::text,'')::date
      ) < v_cycle_end_exclusive;

    select count(distinct l.shift_date::date)::int
    into v_modern_attendance_days
    from public.staff_attendance_logs l
    where l.staff_id=p_staff_id
      and l.status='accepted'
      and l.shift_date::date >= v_cycle_start
      and l.shift_date::date < v_cycle_end_exclusive;
  exception when others then
    v_attendance_available := false;
    v_errors := v_errors || jsonb_build_object('attendance',sqlerrm);
  end;

  return jsonb_build_object(
    'schema','monthly_evaluation_server_evidence_v5',
    'cycle_start',v_cycle_start,
    'cycle_end_exclusive',v_cycle_end_exclusive,
    'ready',v_reviews_available and v_followups_available and v_attendance_available,
    'health',jsonb_build_object(
      'reviews',case when v_reviews_available then 'available' else 'unavailable' end,
      'followups',case when v_followups_available then 'available' else 'unavailable' end,
      'attendance',case when v_attendance_available then 'available' else 'unavailable' end
    ),
    'counts',jsonb_build_object(
      'conversation_reviews',v_review_count,
      'followups',v_followup_count,
      'legacy_attendance_rows',v_legacy_attendance_count,
      'modern_attendance_days',v_modern_attendance_days
    ),
    'errors',v_errors,
    'validated_at',now()
  );
end;
$function$;

create or replace function public.trg_monthly_evaluation_final_snapshot_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_engine integer := 0;
  v_evidence jsonb;
  v_snapshot jsonb;
  v_snapshot_hash text;
begin
  if coalesce(new.metrics_snapshot->>'evaluation_engine_version','') ~ '^[0-9]+$' then
    v_engine := (new.metrics_snapshot->>'evaluation_engine_version')::integer;
  end if;

  if v_engine < 5 or new.status not in ('sent','approved') then
    return new;
  end if;

  v_evidence := public.dawaa_monthly_evaluation_server_evidence_v5(new.staff_id,new.evaluation_month);

  if not coalesce((v_evidence->>'ready')::boolean,false) then
    raise exception 'monthly_evaluation_server_evidence_unavailable'
      using errcode='55000',
            detail=coalesce(v_evidence->'errors','{}'::jsonb)::text;
  end if;

  new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'evidence_ready',true,
      'evidence_health',v_evidence->'health',
      'server_evidence_snapshot',v_evidence
    );

  v_snapshot := jsonb_build_object(
    'schema','monthly_evaluation_final_snapshot_v5',
    'evaluation_id',new.id,
    'staff_id',new.staff_id,
    'staff_name',new.staff_name,
    'staff_role',new.staff_role,
    'branch',new.branch,
    'evaluation_month',new.evaluation_month,
    'cycle_label',to_char(new.evaluation_month,'YYYY-MM'),
    'evaluator_id',new.evaluator_id,
    'evaluator_name',new.evaluator_name,
    'evaluator_role',new.evaluator_role,
    'sections',new.sections,
    'strengths',to_jsonb(new.strengths),
    'development_points',to_jsonb(new.development_points),
    'manager_notes',new.manager_notes,
    'overall_score',new.overall_score,
    'grade',new.grade,
    'active_critical_gates',coalesce(new.metrics_snapshot->'active_critical_gates','[]'::jsonb),
    'axis_evidence_snapshot',coalesce(new.metrics_snapshot->'axis_evidence_snapshot','[]'::jsonb),
    'points_truth',new.metrics_snapshot->'points_truth',
    'server_evidence',v_evidence,
    'coaching_snapshot',new.metrics_snapshot->'coaching_snapshot',
    'employee_feedback_draft',new.metrics_snapshot->'employee_feedback_draft',
    'approved_at',coalesce(new.sent_at,now())
  );

  v_snapshot_hash := md5(v_snapshot::text);

  new.metrics_snapshot := new.metrics_snapshot
    || jsonb_build_object(
      'final_approval_snapshot',v_snapshot,
      'final_approval_hash',v_snapshot_hash,
      'final_approval_snapshot_schema','monthly_evaluation_final_snapshot_v5'
    );

  return new;
end;
$function$;

drop trigger if exists zz_monthly_evaluation_final_snapshot_v5
  on public.staff_monthly_manager_evaluations;

create trigger zz_monthly_evaluation_final_snapshot_v5
before insert or update of sections,metrics_snapshot,strengths,development_points,manager_notes,status,sent_at
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_evaluation_final_snapshot_v5();

create or replace function public.trg_monthly_evaluation_audit_snapshot_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_snapshot jsonb;
  v_hash text;
begin
  if new.action not in ('approved','reapproved') then
    return new;
  end if;

  select
    e.metrics_snapshot->'final_approval_snapshot',
    nullif(e.metrics_snapshot->>'final_approval_hash','')
  into v_snapshot,v_hash
  from public.staff_monthly_manager_evaluations e
  where e.id=new.evaluation_id;

  if v_snapshot is null or v_hash is null then
    raise exception 'monthly_evaluation_final_snapshot_missing_from_audit'
      using errcode='55000';
  end if;

  new.evidence_ready := true;
  new.snapshot := coalesce(new.snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'final_approval_snapshot',v_snapshot,
      'final_approval_hash',v_hash
    );

  return new;
end;
$function$;

drop trigger if exists monthly_evaluation_audit_snapshot_v5
  on public.staff_monthly_evaluation_audit;

create trigger monthly_evaluation_audit_snapshot_v5
before insert
on public.staff_monthly_evaluation_audit
for each row
execute function public.trg_monthly_evaluation_audit_snapshot_v5();

create or replace function public.trg_monthly_evaluation_audit_immutable_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  raise exception 'monthly_evaluation_audit_is_immutable'
    using errcode='55000',
          detail='Monthly evaluation audit rows are append-only. Create a new audit event instead of rewriting history.';
end;
$function$;

drop trigger if exists monthly_evaluation_audit_immutable_v5
  on public.staff_monthly_evaluation_audit;

create trigger monthly_evaluation_audit_immutable_v5
before update or delete
on public.staff_monthly_evaluation_audit
for each row
execute function public.trg_monthly_evaluation_audit_immutable_v5();

revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  from public,anon,authenticated;
revoke all on function public.trg_monthly_evaluation_final_snapshot_v5()
  from public,anon,authenticated;
revoke all on function public.trg_monthly_evaluation_audit_snapshot_v5()
  from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  to service_role;
grant execute on function public.trg_monthly_evaluation_final_snapshot_v5()
  to service_role;
grant execute on function public.trg_monthly_evaluation_audit_snapshot_v5()
  to service_role;

comment on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  is 'Server-owned availability/readiness proof for the three mandatory monthly-evaluation evidence domains.';
comment on function public.trg_monthly_evaluation_final_snapshot_v5()
  is 'Builds the immutable-by-audit final approval snapshot/hash after canonical score validation and before the V5 row is stored.';
comment on function public.trg_monthly_evaluation_audit_snapshot_v5()
  is 'Copies the exact approved V5 snapshot/hash into each approval/reapproval audit event.';

notify pgrst,'reload schema';
