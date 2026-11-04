-- Recompute only the affected employee's shift dates using the attendance engine.
do $$
declare
  v_day record;
begin
  for v_day in
    select distinct a.staff_id, a.shift_date
    from public.biometric_attendance_logs b
    join public.biometric_staff_mapping m on m.provider = b.provider
      and m.device_id = b.device_id::text and m.biometric_user_id = b.biometric_user_id
      and m.active and m.staff_id = b.staff_id
    join public.staff_attendance_logs a on a.biometric_source_log_id = b.id and a.staff_id = b.staff_id
    join public.staff s on s.id = a.staff_id and s.branch = 'فرع شكري'
      and trim(translate(s.name, 'أإآ', 'ااا')) = 'احمد صلاح'
    left join public.attendance_daily_summary d on d.staff_id = a.staff_id and d.attendance_date = a.shift_date
    where b.provider = 'zk_shokry_direct_bridge' and b.device_id::text = 'GED7242701315'
      and b.biometric_user_id = '319'
      and a.shift_date between date '2026-10-31' and date '2026-11-03'
      and (d.staff_id is null or (d.status = 'pending_review' and d.resolution_status = 'absence_review'))
    order by a.shift_date
  loop
    perform public.dawaa_materialize_attendance_day_internal_v2(v_day.staff_id, v_day.shift_date);
  end loop;
end $$;
