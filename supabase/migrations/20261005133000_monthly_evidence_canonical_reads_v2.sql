-- Monthly evaluation evidence must read canonical/current truth, never raw historical rows.

-- One-time reconciliation: retain history, but remove superseded rows from the current set.
update public.conversation_sales_reviews legacy
set is_current=false,
    updated_at=now()
where coalesce(legacy.is_current,true)=true
  and legacy.whatsapp_review_source_id is not null
  and legacy.sales_intelligence_case_id is null
  and exists (
    select 1
    from public.conversation_sales_reviews current_case
    where current_case.whatsapp_review_source_id=legacy.whatsapp_review_source_id
      and current_case.sales_intelligence_case_id is not null
      and coalesce(current_case.is_current,true)=true
  );

update public.conversation_sales_reviews r
set is_current=false,
    updated_at=now()
where coalesce(r.is_current,true)=true
  and r.sales_intelligence_case_id is not null
  and not exists (
    select 1
    from public.sales_intelligence_current_case_analyses c
    where c.case_id=r.sales_intelligence_case_id
  );

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
    from public.conversation_sales_reviews_canonical_v2 r
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
    select count(distinct f.id)::int
    into v_followup_count
    from public.customer_followup_operations_v2 f
    where (
        f.staff_id=p_staff_id
        or f.assigned_staff_id=p_staff_id
        or nullif(trim(coalesce(f.requested_by_staff_id,'')),'')=p_staff_id::text
        or nullif(trim(coalesce(f.assigned_to_staff_id,'')),'')=p_staff_id::text
        or nullif(trim(coalesce(f.handled_by_staff_id,'')),'')=p_staff_id::text
      )
      and coalesce(f.is_hidden,false)=false
      and f.archived_at is null
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
    'read_model','canonical_v2',
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

comment on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) is
  'Monthly V5 evidence readiness/count snapshot using canonical current conversation reviews and non-hidden/non-archived operational follow-ups.';

notify pgrst,'reload schema';
