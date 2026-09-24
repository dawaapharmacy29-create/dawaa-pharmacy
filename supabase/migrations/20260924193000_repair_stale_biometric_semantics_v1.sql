-- Repair stale biometric semantic reviews after schedule/mapping corrections.
-- Only promotes rows that are currently manual_review and are now deterministically
-- accepted by the current semantic engine with confidence >= 0.75.
-- Approved attendance days are never rematerialized/overwritten.

create or replace function public.repair_stale_biometric_semantics_v1(
  p_start date,
  p_end date,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_row record;
  v_decision jsonb;
  v_semantic_type text;
  v_decision_name text;
  v_conf numeric;
  v_reason text;
  v_fixed integer:=0;
  v_rebuilt integer:=0;
  v_skipped_approved integer:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to repair biometric semantics' using errcode='42501';
  end if;

  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_semantic_repair_range' using errcode='22023';
  end if;

  for v_row in
    select
      sal.id as attendance_log_id,
      sal.staff_id,
      sal.shift_date,
      b.id as biometric_log_id,
      b.provider,
      b.raw_payload,
      b.punch_time,
      b.punch_type,
      public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) as effective_time
    from public.staff_attendance_logs sal
    join public.biometric_attendance_logs b on b.id=sal.biometric_source_log_id
    where sal.status='manual_review'
      and sal.biometric_source_log_id is not null
      and sal.shift_date between p_start and p_end
      and sal.rejection_reason ilike '%no_matching_schedule_fallback_to_raw%'
    order by sal.shift_date,sal.recorded_at
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    v_decision:=public.dawaa_biometric_semantic_decision_v1(
      v_row.staff_id,
      v_row.effective_time,
      case lower(trim(coalesce(v_row.punch_type,'')))
        when 'check_in' then 'check_in'
        when 'in' then 'check_in'
        when 'check_out' then 'check_out'
        when 'out' then 'check_out'
        else null
      end,
      v_row.biometric_log_id
    );

    v_semantic_type:=nullif(v_decision->>'semantic_type','');
    v_decision_name:=coalesce(nullif(v_decision->>'decision',''),'review');
    v_conf:=coalesce(nullif(v_decision->>'confidence','')::numeric,0);
    v_reason:=v_decision->>'reason';

    if v_decision_name='accepted' and v_semantic_type is not null and v_conf>=0.75 then
      insert into public.biometric_semantic_decisions(
        biometric_log_id,staff_id,raw_type,semantic_type,decision,confidence,reason,
        schedule_date,scheduled_start_at,scheduled_end_at,duplicate_of_log_id,updated_at
      ) values(
        v_row.biometric_log_id,
        v_row.staff_id,
        case lower(trim(coalesce(v_row.punch_type,'')))
          when 'check_in' then 'check_in'
          when 'in' then 'check_in'
          when 'check_out' then 'check_out'
          when 'out' then 'check_out'
          else null
        end,
        v_semantic_type,
        v_decision_name,
        v_conf,
        v_reason,
        nullif(v_decision->>'schedule_date','')::date,
        nullif(v_decision->>'scheduled_start_at','')::timestamptz,
        nullif(v_decision->>'scheduled_end_at','')::timestamptz,
        nullif(v_decision->>'duplicate_of_log_id','')::uuid,
        now()
      )
      on conflict (biometric_log_id) do update set
        staff_id=excluded.staff_id,
        raw_type=excluded.raw_type,
        semantic_type=excluded.semantic_type,
        decision=excluded.decision,
        confidence=excluded.confidence,
        reason=excluded.reason,
        schedule_date=excluded.schedule_date,
        scheduled_start_at=excluded.scheduled_start_at,
        scheduled_end_at=excluded.scheduled_end_at,
        duplicate_of_log_id=excluded.duplicate_of_log_id,
        updated_at=now();

      update public.staff_attendance_logs
      set attendance_type=v_semantic_type,
          status='accepted',
          rejection_reason=null,
          shift_date=coalesce(nullif(v_decision->>'schedule_date','')::date,shift_date),
          updated_at=now()
      where id=v_row.attendance_log_id
        and status='manual_review';

      if found then
        v_fixed:=v_fixed+1;

        if exists(
          select 1 from public.attendance_daily_summary a
          where a.staff_id=v_row.staff_id
            and a.attendance_date=coalesce(nullif(v_decision->>'schedule_date','')::date,v_row.shift_date)
            and a.status='approved'
        ) then
          v_skipped_approved:=v_skipped_approved+1;
        else
          perform public.dawaa_materialize_attendance_day_internal_v3(
            v_row.staff_id,
            coalesce(nullif(v_decision->>'schedule_date','')::date,v_row.shift_date)
          );
          v_rebuilt:=v_rebuilt+1;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'start',p_start,
    'end',p_end,
    'fixed_events',v_fixed,
    'attendance_days_rebuilt',v_rebuilt,
    'approved_days_not_overwritten',v_skipped_approved,
    'policy','accepted_only_confidence_gte_0_75'
  );
end;
$$;

revoke execute on function public.repair_stale_biometric_semantics_v1(date,date,integer) from public;
grant execute on function public.repair_stale_biometric_semantics_v1(date,date,integer) to anon,authenticated,service_role;
