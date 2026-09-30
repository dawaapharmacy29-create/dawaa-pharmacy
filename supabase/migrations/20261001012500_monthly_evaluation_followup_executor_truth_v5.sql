-- Monthly Evaluation V5: server evidence uses actual follow-up executor truth and resolved attendance truth.

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
  v_attendance_pending_review_days integer := 0;
  v_attendance_conflict_days integer := 0;
  v_attendance_finalized boolean := false;
  v_errors jsonb := '{}'::jsonb;
begin
  begin
    select count(distinct r.id)::int into v_review_count
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

  begin
    select count(*)::int into v_followup_count
    from public.daily_followups f
    where coalesce(
      nullif(trim(f.handled_by_staff_id),''),
      nullif(trim(f.assigned_to_staff_id),''),
      f.assigned_staff_id::text,
      f.staff_id::text
    ) = p_staff_id::text
      and (f.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
      and (f.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
  exception when others then
    v_followups_available := false;
    v_errors := v_errors || jsonb_build_object('followups',sqlerrm);
  end;

  begin
    select count(*)::int into v_legacy_attendance_count
    from public.attendance a
    where a.staff_id=p_staff_id::text
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) >= v_cycle_start
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) < v_cycle_end_exclusive;

    select count(distinct l.shift_date::date)::int into v_modern_attendance_days
    from public.staff_attendance_logs l
    where l.staff_id=p_staff_id and l.status='accepted'
      and l.shift_date::date >= v_cycle_start and l.shift_date::date < v_cycle_end_exclusive;

    select count(*)::int into v_attendance_pending_review_days
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id
      and a.attendance_date >= v_cycle_start and a.attendance_date < v_cycle_end_exclusive
      and (coalesce(a.status,'') <> 'approved' or coalesce(a.review_required,false));

    select count(*)::int into v_attendance_conflict_days
    from (
      select l.attendance_date
      from public.attendance_impact_ledger l
      where l.staff_id=p_staff_id
        and l.attendance_date >= v_cycle_start and l.attendance_date < v_cycle_end_exclusive
        and l.reversal_of is null and coalesce(l.impact_status,'') <> 'reversed'
      group by l.attendance_date
      having count(*) > 1
    ) conflicts;

    v_attendance_finalized := v_attendance_pending_review_days=0 and v_attendance_conflict_days=0;
  exception when others then
    v_attendance_available := false;
    v_attendance_finalized := false;
    v_errors := v_errors || jsonb_build_object('attendance',sqlerrm);
  end;

  return jsonb_build_object(
    'schema','monthly_evaluation_server_evidence_v5',
    'cycle_start',v_cycle_start,
    'cycle_end_exclusive',v_cycle_end_exclusive,
    'ready',v_reviews_available and v_followups_available and v_attendance_available and v_attendance_finalized,
    'health',jsonb_build_object(
      'reviews',case when v_reviews_available then 'available' else 'unavailable' end,
      'followups',case when v_followups_available then 'available' else 'unavailable' end,
      'attendance',case when v_attendance_available then 'available' else 'unavailable' end,
      'attendance_finalization',case when not v_attendance_available then 'unavailable' when v_attendance_finalized then 'clear' else 'blocked' end
    ),
    'counts',jsonb_build_object(
      'conversation_reviews',v_review_count,
      'followups',v_followup_count,
      'legacy_attendance_rows',v_legacy_attendance_count,
      'modern_attendance_days',v_modern_attendance_days,
      'attendance_pending_review_days',v_attendance_pending_review_days,
      'attendance_conflict_days',v_attendance_conflict_days
    ),
    'attendance_finalization',jsonb_build_object(
      'ready',v_attendance_finalized,
      'pending_review_days',v_attendance_pending_review_days,
      'conflict_days',v_attendance_conflict_days
    ),
    'errors',v_errors,
    'validated_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) to service_role;

notify pgrst,'reload schema';
