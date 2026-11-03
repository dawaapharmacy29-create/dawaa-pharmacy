-- A fingerprint device that missed Egypt's official time change is corrected on its own, for history and for new punches.
do $$
declare
  v_id uuid;
  v_ids uuid[];
  v_time timestamptz;
  function_name text;
begin
  -- History replay: the three punches after the device kept summer time get one hour; the rest none.
  if (select string_agg(event_id || ':' || offset_minutes, ',' order by event_id) from public.biometric_punch_clock_offsets_v1)
     <> 'h2:60,h3:60,h4:60' then
    raise exception 'history_offsets_wrong: %', (select jsonb_agg(o) from public.biometric_punch_clock_offsets_v1 o);
  end if;
  -- The employee punched at 09:00 Cairo (07:00 UTC); the stored punch and its attendance log now say so.
  if (select punch_time from public.biometric_attendance_logs where raw_payload->>'event_id' = 'h2') <> '2026-11-01 07:00:00+00'
     or (select s.recorded_at from public.staff_attendance_logs s join public.biometric_attendance_logs l on l.id = s.biometric_source_log_id
         where l.raw_payload->>'event_id' = 'h2') <> '2026-11-01 07:00:00+00' then
    raise exception 'history_punch_not_corrected';
  end if;
  -- Untouched: the in-sync summer punch and the device that was right.
  if (select punch_time from public.biometric_attendance_logs where raw_payload->>'event_id' = 'h1') <> '2026-10-20 06:00:00+00'
     or (select punch_time from public.biometric_attendance_logs where raw_payload->>'event_id' = 'h5') <> '2026-11-01 07:00:00+00' then
    raise exception 'history_in_sync_changed';
  end if;
  -- Days the system approved from the wrong hour are rebuilt; the day a manager approved is left to the manager.
  if (select string_agg(staff_id::text || '@' || attendance_date, ',' order by staff_id) from public.materialized_days_log)
     <> '00000000-0000-4000-9000-000000000001@2026-11-01,00000000-0000-4000-9000-000000000002@2026-11-02' then
    raise exception 'rebuilt_days_wrong: %', (select jsonb_agg(m) from public.materialized_days_log m);
  end if;
  if (select first_in from public.attendance_daily_summary
      where staff_id = '00000000-0000-4000-9000-000000000001' and attendance_date = '2026-11-01') <> '2026-11-01 07:00:00+00' then
    raise exception 'system_day_not_rebuilt';
  end if;
  if (select approved_by || '|' || first_in from public.attendance_daily_summary
      where staff_id = '00000000-0000-4000-9000-000000000003')
     <> 'manager-account|' || '2026-11-03 08:00:00+00'::timestamptz then
    raise exception 'manager_day_touched';
  end if;
  -- The replay left the device's last state behind: ahead by one hour.
  if (select offset_minutes from public.biometric_device_clock_state_v1 where provider = 'zk_shami_direct_bridge' and device_key = 'DEV-A') <> 60 then
    raise exception 'state_not_seeded';
  end if;

  -- Live: the device still shows 10:00 for a 09:00 punch → stored as 09:00.
  v_id := public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'l1', '2026-11-04 10:00:00', '2026-11-04 07:03:00+00');
  if (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2026-11-04 07:00:00+00'
     or public.dawaa_fingerprint_effective_time_v1('zk_shami_direct_bridge',
          (select raw_payload from public.biometric_attendance_logs where id = v_id), now()) <> '2026-11-04 07:00:00+00' then
    raise exception 'live_ahead_not_corrected';
  end if;
  -- The same event sent again keeps the first decision.
  v_id := public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'l1', '2026-11-04 10:00:00', '2026-11-05 07:00:00+00');
  if public.dawaa_fingerprint_effective_time_v1('zk_shami_direct_bridge',
       (select raw_payload from public.biometric_attendance_logs where id = v_id), now()) <> '2026-11-04 07:00:00+00'
     or (select offset_minutes from public.biometric_device_clock_state_v1 where device_key = 'DEV-A') <> 60 then
    raise exception 'resent_event_redecided';
  end if;

  -- Someone sets the device right: a 12:00 punch arriving at 12:02 is taken as is, and the state resets.
  v_id := public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'l2', '2026-11-04 12:00:00', '2026-11-04 10:02:00+00');
  if (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2026-11-04 10:00:00+00'
     or exists (select 1 from public.biometric_punch_clock_offsets_v1 where event_id = 'l2')
     or (select offset_minutes from public.biometric_device_clock_state_v1 where device_key = 'DEV-A') <> 0 then
    raise exception 'device_fixed_not_followed';
  end if;
  -- One upload an hour late is only a slow bridge.
  v_id := public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'l3', '2026-11-04 13:00:00', '2026-11-04 12:00:00+00');
  if exists (select 1 from public.biometric_punch_clock_offsets_v1 where event_id = 'l3') then
    raise exception 'slow_upload_treated_as_clock';
  end if;

  -- A missed spring change (summer 2027, Cairo UTC+3): the device shows 08:00 for a real 09:00.
  -- Three uploads in a row an hour early are needed before the hour is added back.
  perform public.fixture_punch('zk_shokry_direct_bridge', 'DEV-C', 'b1', '2027-05-10 08:00:00', '2027-05-10 06:02:00+00');
  perform public.fixture_punch('zk_shokry_direct_bridge', 'DEV-C', 'b2', '2027-05-10 08:30:00', '2027-05-10 06:32:00+00');
  v_id := public.fixture_punch('zk_shokry_direct_bridge', 'DEV-C', 'b3', '2027-05-10 09:00:00', '2027-05-10 07:02:00+00');
  if exists (select 1 from public.biometric_punch_clock_offsets_v1 where event_id in ('b1', 'b2'))
     or (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2027-05-10 07:00:00+00' then
    raise exception 'device_behind_not_detected';
  end if;
  -- A backlog uploaded much later keeps the device's known state.
  v_id := public.fixture_punch('zk_shokry_direct_bridge', 'DEV-C', 'b4', '2027-05-10 09:10:00', '2027-05-10 12:00:00+00');
  if (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2027-05-10 07:10:00+00' then
    raise exception 'late_upload_lost_state';
  end if;

  -- Official changes need no correction: the repeated hour on the night summer ends, and plain winter time.
  v_id := public.fixture_punch('zk_shokry_direct_bridge', 'DEV-D', 'd1', '2026-10-29 23:29:09', '2026-10-29 20:30:19+00');
  if (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2026-10-29 20:29:09+00' then
    raise exception 'fall_back_hour_wrong: %', (select punch_time from public.biometric_attendance_logs where id = v_id);
  end if;
  v_id := public.fixture_punch('zk_shokry_direct_bridge', 'DEV-D', 'd2', '2027-01-15 09:00:00', '2027-01-15 07:01:00+00');
  if (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2027-01-15 07:00:00+00'
     or exists (select 1 from public.biometric_punch_clock_offsets_v1 where event_id = 'd2') then
    raise exception 'winter_time_changed';
  end if;

  -- Other providers are left alone.
  v_id := public.fixture_punch('fingerprint_vendor_primary', '101', 'v1', '2026-11-04 10:00:00', '2026-11-04 07:03:00+00');
  if exists (select 1 from public.biometric_punch_clock_offsets_v1 where event_id = 'v1')
     or (select punch_time from public.biometric_attendance_logs where id = v_id) <> '2026-11-04 08:00:00+00' then
    raise exception 'other_provider_changed';
  end if;

  -- Nothing here is readable or callable from the browser roles.
  if has_table_privilege('anon', 'public.biometric_punch_clock_offsets_v1', 'select')
     or has_table_privilege('authenticated', 'public.biometric_device_clock_state_v1', 'select') then
    raise exception 'clock_tables_exposed';
  end if;
  foreach function_name in array array[
    'public.dawaa_biometric_clock_decide_v1(text,text,text,numeric,timestamptz,integer)',
    'public.dawaa_biometric_clock_lead_minutes_v1(jsonb,timestamptz)',
    'public.dawaa_biometric_device_clock_on_insert_v1()'] loop
    if has_function_privilege('anon', function_name, 'execute') or has_function_privilege('authenticated', function_name, 'execute') then
      raise exception 'function_exposed: %', function_name;
    end if;
  end loop;
end $$;
