-- Make final monthly-evaluation server evidence role-aware.
-- A source that is irrelevant to the employee's evaluation profile must not block approval
-- and must not be represented as if personal evidence had been measured.

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
  v_role text := 'other';
  v_needs_reviews boolean := false;
  v_needs_followups boolean := false;
  v_needs_attendance boolean := false;
  v_reviews_available boolean := true;
  v_followups_available boolean := true;
  v_attendance_available boolean := true;
  v_review_count integer := 0;
  v_followup_count integer := 0;
  v_legacy_attendance_count integer := 0;
  v_modern_attendance_days integer := 0;
  v_errors jsonb := '{}'::jsonb;
begin
  select public.dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,''))
  into v_role
  from public.staff s
  where s.id=p_staff_id;

  if not found then
    return jsonb_build_object(
      'schema','monthly_evaluation_server_evidence_v5',
      'ready',false,
      'errors',jsonb_build_object('staff','staff_not_found')
    );
  end if;

  v_needs_reviews := v_role in ('doctor','delivery','customer_service');
  v_needs_followups := v_role in ('doctor','customer_service','purchasing');
  v_needs_attendance := v_role in ('doctor','assistant','inventory_assistant','delivery','customer_service','shift_supervisor');

  if v_needs_reviews then
    begin
      select count(distinct r.id)::int
      into v_review_count
      from public.conversation_sales_reviews r
      where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
        and (
          (r.conversation_date is not null and r.conversation_date::date >= v_cycle_start and r.conversation_date::date < v_cycle_end_exclusive)
          or
          (r.conversation_date is null and (r.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start and (r.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive)
        );
    exception when others then
      v_reviews_available := false;
      v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
    end;
  end if;

  if v_needs_followups then
    begin
      select count(*)::int
      into v_followup_count
      from public.daily_followups f
      where (f.assigned_staff_id=p_staff_id or f.requested_by_staff_id=p_staff_id::text)
        and (f.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
        and (f.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
    exception when others then
      v_followups_available := false;
      v_errors := v_errors || jsonb_build_object('followups',sqlerrm);
    end;
  end if;

  if v_needs_attendance then
    begin
      select count(*)::int
      into v_legacy_attendance_count
      from public.attendance a
      where a.staff_id=p_staff_id::text
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
  end if;

  return jsonb_build_object(
    'schema','monthly_evaluation_server_evidence_v5',
    'canonical_role',v_role,
    'cycle_start',v_cycle_start,
    'cycle_end_exclusive',v_cycle_end_exclusive,
    'required',jsonb_build_object(
      'reviews',v_needs_reviews,
      'followups',v_needs_followups,
      'attendance',v_needs_attendance
    ),
    'ready',
      (not v_needs_reviews or v_reviews_available)
      and (not v_needs_followups or v_followups_available)
      and (not v_needs_attendance or v_attendance_available),
    'health',jsonb_build_object(
      'reviews',case when not v_needs_reviews then 'not_required' when v_reviews_available then 'available' else 'unavailable' end,
      'followups',case when not v_needs_followups then 'not_required' when v_followups_available then 'available' else 'unavailable' end,
      'attendance',case when not v_needs_attendance then 'not_required' when v_attendance_available then 'available' else 'unavailable' end
    ),
    'counts',jsonb_build_object(
      'conversation_reviews',case when v_needs_reviews then v_review_count else null end,
      'followups',case when v_needs_followups then v_followup_count else null end,
      'legacy_attendance_rows',case when v_needs_attendance then v_legacy_attendance_count else null end,
      'modern_attendance_days',case when v_needs_attendance then v_modern_attendance_days else null end
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

notify pgrst,'reload schema';
