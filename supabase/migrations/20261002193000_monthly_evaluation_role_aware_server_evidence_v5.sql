-- Monthly Evaluation V5: keep server approval evidence aligned with the role profile.
-- The UI already requires only evidence domains used by the employee's profile.
-- This server gate must not re-introduce doctor/customer-service-only requirements
-- for delivery, cleaning, inventory, management, or other roles.

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
  v_cycle_start date := date_trunc('month',p_evaluation_month)::date - interval '6 days';
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
    'doctor','assistant','inventory_assistant','cleaning','delivery',
    'customer_service','shift_supervisor'
  );

  begin
    select count(*)::int into v_review_count
    from public.conversation_evaluations ce
    where ce.staff_id=p_staff_id
      and ce.created_at::date >= v_cycle_start
      and ce.created_at::date < v_cycle_end_exclusive;
  exception when others then
    v_reviews_available := false;
    v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
  end;

  begin
    select count(*)::int into v_followup_count
    from public.customer_followups cf
    where coalesce(cf.handled_by,cf.assigned_to,cf.assigned_staff,cf.staff_id)=p_staff_id
      and coalesce(cf.completed_at,cf.updated_at,cf.created_at)::date >= v_cycle_start
      and coalesce(cf.completed_at,cf.updated_at,cf.created_at)::date < v_cycle_end_exclusive;
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

notify pgrst,'reload schema';
