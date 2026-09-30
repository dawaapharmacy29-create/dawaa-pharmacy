-- Monthly Evaluation V5 server evidence type compatibility.
-- Legacy attendance/requester ownership columns are TEXT while canonical staff ids are UUID.

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
    where (
      f.assigned_staff_id=p_staff_id
      or f.requested_by_staff_id=p_staff_id::text
    )
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
    where a.staff_id=p_staff_id::text
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

revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  from public,anon,authenticated;

grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date)
  to service_role;

notify pgrst,'reload schema';
