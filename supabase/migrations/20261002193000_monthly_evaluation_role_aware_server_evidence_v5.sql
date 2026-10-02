-- Monthly Evaluation V5: keep server approval evidence aligned with the role profile.
-- The UI already requires only evidence domains used by the employee's profile.
-- This server gate must not re-introduce doctor/customer-service-only requirements
-- for delivery, cleaning, inventory, management, or other roles.

-- Keep database role normalization in exact parity with the frontend canonicalStaffRole.
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

  if v_role in ('صيدلاني','صيدلي','دكتور','doctor','pharmacist','صيدلي اول','صيدلي أول','senior pharmacist','pharmacist senior') then return 'doctor'; end if;
  if v_role in ('مساعد','مساعد صيدلي','مساعد صيدلية','مساعد صيدليه','assistant','pharmacy assistant') then return 'assistant'; end if;
  if v_role='inventory assistant' or v_role like '%مساعد مخزن%' or v_role like '%مساعد جرد%' or v_role like '%مساعد مخزون%' then return 'inventory_assistant'; end if;
  if v_role like '%نظاف%' or v_role in ('cleaning','cleaner','cleaning supervisor') then return 'cleaning'; end if;
  if v_role in ('توصيل','دليفري','مندوب','مندوب توصيل','مندوب دليفري','delivery','delivery rider','delivery driver','rider') then return 'delivery'; end if;
  if v_role in ('خدمة عملاء','خدمة العملاء','مسؤول خدمة العملاء','مسئول خدمة العملاء','مسؤولة خدمة العملاء','customer service','كول سنتر','call center') then return 'customer_service'; end if;
  if v_role in ('مدير خدمة العملاء','مديرة خدمة العملاء','customer service manager') then return 'customer_service_manager'; end if;
  if v_role in ('مسؤول الشيفت','مسئول الشيفت','مسئولة الشيفت','مشرف شيفت','مشرفة شيفت','shift supervisor','shift supervisor morning','shift supervisor evening',
                'مسؤول شيفت صباحي','مسئول شيفت صباحي','مسئولة شيفت صباحي','مشرف شيفت صباحي','مشرفة شيفت صباحي',
                'مسؤول شيفت مسائي','مسئول شيفت مسائي','مسئولة شيفت مسائي','مشرف شيفت مسائي','مشرفة شيفت مسائي')
    then return 'shift_supervisor'; end if;
  if v_role in ('مدير فرع','مديرة فرع','branch manager','branch manager shamy','branch manager shokry') then return 'branch_manager'; end if;
  if v_role in ('مدير الفروع','مديرة الفروع','branches manager') then return 'branches_manager'; end if;
  if v_role like '%مشتريات%' or v_role in ('purchasing','purchasing manager') then return 'purchasing'; end if;
  if v_role in ('مدير تنفيذي','مدير عام','executive manager','general manager') then return 'executive'; end if;
  if v_role in ('admin','أدمن','owner') then return 'admin'; end if;
  return 'other';
end;
$function$;

create or replace function public.dawaa_monthly_evaluation_server_evidence_v5(
  p_staff_id uuid,
  p_evaluation_month date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle_start date := (date_trunc('month',p_evaluation_month)::date - interval '1 month' + interval '25 days')::date;
  v_cycle_end_exclusive date := date_trunc('month',p_evaluation_month)::date + interval '25 days';
  v_role text;
  v_needs_reviews boolean := false;
  v_needs_followups boolean := false;
  v_needs_attendance boolean := false;
  v_reviews_available boolean := true;
  v_followups_available boolean := true;
  v_attendance_available boolean := true;
  v_review_count int := 0;
  v_followup_count int := 0;
  v_legacy_attendance_count int := 0;
  v_modern_attendance_days int := 0;
  v_errors jsonb := '{}'::jsonb;
begin
  select public.dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,''))
    into v_role
  from public.staff s
  where s.id=p_staff_id;

  if v_role is null then
    return jsonb_build_object(
      'schema','monthly_evaluation_server_evidence_v5',
      'ready',false,
      'role','other',
      'errors',jsonb_build_object('staff','staff_not_found')
    );
  end if;

  -- Mirrors the V5 role profiles. Reviews are mandatory only where reviewed
  -- conversations/dispensing/sales-quality are actual axes.
  v_needs_reviews := v_role in ('doctor','customer_service');
  -- Follow-up/request evidence is mandatory for profiles with a follow-up/request axis.
  v_needs_followups := v_role in ('doctor','customer_service','customer_service_manager','purchasing');
  -- Attendance is an explicit axis for these profiles. Other management profiles
  -- must not be blocked by an unrelated attendance feed.
  v_needs_attendance := v_role in (
    'doctor','assistant','inventory_assistant','delivery',
    'customer_service','shift_supervisor'
  );

  begin
    select count(*)::int into v_review_count
    from public.conversation_sales_reviews r
    where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
      and (
        (r.conversation_date is not null and r.conversation_date::date >= v_cycle_start and r.conversation_date::date < v_cycle_end_exclusive)
        or
        (r.conversation_date is null
          and (r.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
          and (r.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive)
      );
  exception when others then
    v_reviews_available := false;
    v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
  end;

  begin
    select count(*)::int into v_followup_count
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
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) >= v_cycle_start
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) < v_cycle_end_exclusive;

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
    'role',v_role,
    'requirements',jsonb_build_object(
      'reviews',v_needs_reviews,
      'followups',v_needs_followups,
      'attendance',v_needs_attendance
    ),
    'ready',
      (not v_needs_reviews or v_reviews_available)
      and (not v_needs_followups or v_followups_available)
      and (not v_needs_attendance or v_attendance_available),
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

revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  to service_role;

comment on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  is 'Server-owned role-aware availability/readiness proof for monthly-evaluation evidence domains.';

-- Compare the currently authoritative attendance truth with the frozen approval
-- snapshot. Reapproval is evidence-driven; age of sent_at alone is not drift.
create or replace function public.dawaa_monthly_evaluation_evidence_drift_v5(
  p_staff_id uuid,
  p_evaluation_month date,
  p_approved_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_current jsonb;
  v_approved jsonb := coalesce(p_approved_snapshot->'server_evidence','{}'::jsonb);
  v_role text := coalesce(p_approved_snapshot->'server_evidence'->>'role','');
  v_attendance_required boolean := coalesce((p_approved_snapshot->'server_evidence'->'requirements'->>'attendance')::boolean,false);
  v_changed boolean := false;
begin
  v_current := public.dawaa_monthly_evaluation_server_evidence_v5(p_staff_id,p_evaluation_month);

  if v_role = '' then
    v_role := coalesce(v_current->>'role','other');
  end if;

  if not (p_approved_snapshot ? 'server_evidence') then
    return jsonb_build_object(
      'schema','monthly_evaluation_evidence_drift_v5',
      'role',v_role,
      'attendance_changed',false,
      'comparable',false,
      'reason','approved_snapshot_missing_server_evidence'
    );
  end if;

  if v_attendance_required then
    v_changed :=
      coalesce(v_current->'counts'->>'legacy_attendance_rows','') is distinct from
        coalesce(v_approved->'counts'->>'legacy_attendance_rows','')
      or
      coalesce(v_current->'counts'->>'modern_attendance_days','') is distinct from
        coalesce(v_approved->'counts'->>'modern_attendance_days','')
      or
      coalesce(v_current->'health'->>'attendance','') is distinct from
        coalesce(v_approved->'health'->>'attendance','');
  end if;

  return jsonb_build_object(
    'schema','monthly_evaluation_evidence_drift_v5',
    'role',v_role,
    'attendance_required',v_attendance_required,
    'attendance_changed',v_changed,
    'comparable',true,
    'approved_attendance',jsonb_build_object(
      'health',v_approved->'health'->>'attendance',
      'legacy_attendance_rows',v_approved->'counts'->>'legacy_attendance_rows',
      'modern_attendance_days',v_approved->'counts'->>'modern_attendance_days'
    ),
    'current_attendance',jsonb_build_object(
      'health',v_current->'health'->>'attendance',
      'legacy_attendance_rows',v_current->'counts'->>'legacy_attendance_rows',
      'modern_attendance_days',v_current->'counts'->>'modern_attendance_days'
    ),
    'checked_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb)
  from public,anon;
grant execute on function public.dawaa_monthly_evaluation_evidence_drift_v5(uuid,date,jsonb)
  to authenticated,service_role;


-- Listing status must describe the persisted approval state. Evidence drift is
-- evaluated against the frozen snapshot by daw aa_monthly_evaluation_evidence_drift_v5;
-- sent_at age alone must never manufacture a reapproval requirement.
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
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;
  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then return; end if;

  return query
  select
    s.id,
    s.name,
    coalesce(s.role,s.type),
    coalesce(s.branch,''),
    coalesce(s.status,case when coalesce(s.active,s.is_active,true) then 'active' else 'inactive' end),
    case when e.id is null then 'not_started' else e.status end,
    case when e.id is null then null else e.overall_score end,
    e.sent_at,
    coalesce(lower(e.metrics_snapshot->>'evidence_ready') in ('true','t','1'),false)
  from public.staff s
  left join public.staff_monthly_manager_evaluations e
    on e.staff_id=s.id and e.evaluation_month=v_month
  where coalesce(s.active,s.is_active,true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|موقوف|غير نشط|archived')
    and public.dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,'')) <> 'other'
    and (
      v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
      or (
        v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
        and coalesce(s.branch,'')=v_actor.branch
        and public.dawaa_monthly_evaluation_branch_manager_subject_allowed_v5(coalesce(s.role,s.type,''))
      )
      or (v_actor.staff_id is not null and s.id=v_actor.staff_id)
    )
    and (
      p_branch is null or p_branch='' or coalesce(s.branch,'')=p_branch
      or v_actor.role not in ('general_manager','branches_manager','executive_manager','executive','admin')
    )
  order by
    case when e.id is null then 0 when e.status='draft' then 1 else 2 end,
    s.name;
end;
$function$;


-- Audit integrity: the hash copied to an approval event must actually describe
-- the exact frozen snapshot copied with it. Historical approval rows remain
-- append-only; reapproval creates a new row and never rewrites the old one.
create or replace function public.trg_monthly_evaluation_audit_snapshot_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_snapshot jsonb;
  v_hash text;
  v_computed_hash text;
begin
  if new.action not in ('approved','reapproved') then return new; end if;

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

  v_computed_hash := md5(v_snapshot::text);
  if v_computed_hash is distinct from v_hash then
    raise exception 'monthly_evaluation_final_snapshot_hash_mismatch'
      using errcode='55000',
            detail='The stored approval hash does not match the frozen approval snapshot.';
  end if;

  new.evidence_ready := true;
  new.snapshot := coalesce(new.snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'final_approval_snapshot',v_snapshot,
      'final_approval_hash',v_hash,
      'final_approval_hash_verified',true
    );
  return new;
end;
$function$;


notify pgrst,'reload schema';
