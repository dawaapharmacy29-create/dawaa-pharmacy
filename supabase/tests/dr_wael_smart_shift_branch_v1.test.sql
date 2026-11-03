-- «بصمات د وائل» v2: the punches suggest the shift and the branch; the two viewers apply them.
insert into public.dr_wael_fingerprints_viewers_v1(staff_account_id, label) values
  ('00000000-0000-4000-8000-000000000001', 'مشاهد');

do $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v jsonb;
  v_emp jsonb;
  v_reda uuid := '00000000-0000-4000-9000-000000000001';
  v_regular uuid := '00000000-0000-4000-9000-000000000002';
  v_hagar uuid := '00000000-0000-4000-9000-000000000003';
  v_cycle_start date;
  v_friday date;
  function_name text;
begin
  -- المخزن joined the engine scope; its never-built day of this cycle was built at migration time.
  if position($q$'المخزن'$q$ in pg_get_functiondef('public.dawaa_attendance_engine_route_v1(uuid)'::regprocedure)) = 0 then
    raise exception 'warehouse_not_in_engine_scope';
  end if;
  v_cycle_start := (date_trunc('month', case when extract(day from v_today) >= 26 then v_today else v_today - interval '1 month' end)
                    + interval '25 days')::date;
  if v_today - 1 >= v_cycle_start and not exists (
       select 1 from public.materialized_days_log where staff_id = v_hagar and attendance_date = v_today - 1) then
    raise exception 'warehouse_day_not_built';
  end if;
  -- The roaming list is seeded by name.
  if not exists (select 1 from public.dr_wael_roaming_staff_v1 where staff_id = v_hagar) then
    raise exception 'roaming_not_seeded';
  end if;

  -- Only the listed viewers.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.get_dr_wael_smart_insights_v1();
    raise exception 'insights_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dr_wael_apply_shift_change_v1(v_reda, '14:30', '20:30', 'day', v_today);
    raise exception 'shift_change_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dr_wael_apply_branch_change_v1(v_regular, 'فرع الشامي');
    raise exception 'branch_change_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dr_wael_set_roaming_v1(v_regular, true);
    raise exception 'roaming_allowed';
  exception when insufficient_privilege then null;
  end;

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);

  -- The bundle: a «توصيل» role with type Pharmacist is a driver; roaming is flagged.
  v := public.get_dr_wael_fingerprints_v1();
  if not exists (select 1 from jsonb_array_elements(v->'employees') e
                 where e->>'staff_id' = '00000000-0000-4000-9000-000000000004' and (e->>'delivery')::boolean)
     or not exists (select 1 from jsonb_array_elements(v->'employees') e
                    where e->>'staff_id' = v_hagar::text and (e->>'roaming')::boolean) then
    raise exception 'bundle_flags_wrong: %', v->'employees';
  end if;

  -- Insights: Reda works 14:30–20:30 against a 10–18 schedule; the regular employee is on time but on the
  -- Shami device every day; the roaming employee is only shown where she punched today.
  v := public.get_dr_wael_smart_insights_v1();
  select e into v_emp from jsonb_array_elements(v->'employees') e where e->>'staff_id' = v_reda::text;
  if v_emp->'shift'->>'start' <> '14:30' or v_emp->'shift'->>'end' <> '20:30' or (v_emp->'shift'->>'days')::int <> 10
     or (v_emp->'shift'->>'since')::date <> v_today - 10 or v_emp->>'branch_suggestion' is not null then
    raise exception 'reda_insight_wrong: %', v_emp;
  end if;
  select e into v_emp from jsonb_array_elements(v->'employees') e where e->>'staff_id' = v_regular::text;
  if v_emp->'shift' <> 'null'::jsonb or v_emp->>'branch_suggestion' <> 'فرع الشامي' then
    raise exception 'regular_insight_wrong: %', v_emp;
  end if;
  select e into v_emp from jsonb_array_elements(v->'employees') e where e->>'staff_id' = v_hagar::text;
  if v_emp->>'today_branch' <> 'فرع الشامي' or v_emp->>'branch_suggestion' is not null or not (v_emp->>'roaming')::boolean then
    raise exception 'roaming_insight_wrong: %', v_emp;
  end if;
  if exists (select 1 from jsonb_array_elements(v->'employees') e where e->>'staff_id' = '00000000-0000-4000-9000-000000000005') then
    raise exception 'other_branch_in_insights';
  end if;

  -- Permanent from 3 days ago: the old version closes the day before, the new one starts; past days are
  -- rebuilt except the one a manager approved.
  delete from public.materialized_days_log;
  v := public.dr_wael_apply_shift_change_v1(v_reda, '14:30', '20:30', 'permanent', v_today - 3, null, null, 'ميعادها الفعلي');
  if (v->>'rows_written')::int <> 7 or (v->>'days_kept_manager_approved')::int <> 1 or (v->>'days_rebuilt')::int <> 2 then
    raise exception 'permanent_result_wrong: %', v;
  end if;
  if (select shift_start from public.attendance_schedule_for_date_v1(v_reda, v_today)) <> '14:30'
     or (select shift_start from public.attendance_schedule_for_date_v1(v_reda, v_today + 30)) <> '14:30'
     or (select shift_start from public.attendance_schedule_for_date_v1(v_reda, v_today - 4)) <> '10:00' then
    raise exception 'permanent_schedule_wrong';
  end if;
  if exists (select 1 from public.shift_schedules where staff_id = v_reda and source is distinct from 'dr_wael_smart_shift_v1'
             and effective_to is distinct from v_today - 4) then
    raise exception 'old_version_not_closed';
  end if;
  if (select approved_by from public.attendance_daily_summary where staff_id = v_reda and attendance_date = v_today - 2) <> 'manager-account'
     or exists (select 1 from public.materialized_days_log where staff_id = v_reda and attendance_date = v_today - 2) then
    raise exception 'manager_day_touched';
  end if;
  -- Re-applying the same date updates the new version in place.
  v := public.dr_wael_apply_shift_change_v1(v_reda, '15:00', '21:00', 'permanent', v_today - 3);
  if (select count(*) from public.shift_schedules where staff_id = v_reda) <> 14
     or (select shift_start from public.attendance_schedule_for_date_v1(v_reda, v_today)) <> '15:00' then
    raise exception 'permanent_reapply_wrong';
  end if;

  -- One day (tomorrow): only that date changes.
  v := public.dr_wael_apply_shift_change_v1(v_regular, '12:00', '20:00', 'day', v_today + 1);
  if (select shift_start from public.attendance_schedule_for_date_v1(v_regular, v_today + 1)) <> '12:00'
     or (select shift_start from public.attendance_schedule_for_date_v1(v_regular, v_today + 2)) <> '09:00' then
    raise exception 'day_change_wrong';
  end if;
  -- A week: six working days, the Friday off is kept.
  v := public.dr_wael_apply_shift_change_v1(v_regular, '13:00', '21:00', 'period', v_today + 3, v_today + 9);
  v_friday := (select g::date from generate_series(v_today + 3, v_today + 9, interval '1 day') g where extract(dow from g) = 5);
  if (v->>'rows_written')::int <> 6 or (select is_off from public.attendance_schedule_for_date_v1(v_regular, v_friday)) is not true
     or (select shift_start from public.attendance_schedule_for_date_v1(v_regular, v_today + 10)) <> '09:00' then
    raise exception 'period_change_wrong: %', v;
  end if;
  begin
    perform public.dr_wael_apply_shift_change_v1(v_regular, '13:00', '21:00', 'period', v_today, v_today + 90);
    raise exception 'long_period_allowed';
  exception when invalid_parameter_value then null;
  end;

  -- Branch: the regular employee moves to the Shami branch, with the login account.
  v := public.dr_wael_apply_branch_change_v1(v_regular, 'فرع الشامي');
  if (select branch from public.staff where id = v_regular) <> 'فرع الشامي'
     or (select branch from public.staff_accounts where id = '00000000-0000-4000-8000-000000000012') <> 'فرع الشامي' then
    raise exception 'branch_change_wrong: %', v;
  end if;
  begin
    perform public.dr_wael_apply_branch_change_v1(v_regular, 'فرع زكريا');
    raise exception 'outside_branch_allowed';
  exception when invalid_parameter_value then null;
  end;

  -- Roaming on/off.
  perform public.dr_wael_set_roaming_v1(v_regular, true);
  perform public.dr_wael_set_roaming_v1(v_hagar, false);
  if not exists (select 1 from public.dr_wael_roaming_staff_v1 where staff_id = v_regular)
     or exists (select 1 from public.dr_wael_roaming_staff_v1 where staff_id = v_hagar) then
    raise exception 'roaming_toggle_wrong';
  end if;
  if (select count(*) from public.dr_wael_change_log_v1) <> 7 then
    raise exception 'change_log_wrong: %', (select jsonb_agg(c.kind) from public.dr_wael_change_log_v1 c);
  end if;

  -- Browser roles reach the guarded RPCs only; the helpers and tables stay closed.
  foreach function_name in array array[
    'public.get_dr_wael_smart_insights_v1()',
    'public.dr_wael_apply_shift_change_v1(uuid,time,time,text,date,date,text[],text)',
    'public.dr_wael_apply_branch_change_v1(uuid,text)',
    'public.dr_wael_set_roaming_v1(uuid,boolean)'] loop
    if not has_function_privilege('anon', function_name, 'execute') then
      raise exception 'rpc_not_granted: %', function_name;
    end if;
  end loop;
  foreach function_name in array array[
    'public.dr_wael_is_delivery_v1(uuid,text)', 'public.dr_wael_device_branch_v1(text)',
    'public.dr_wael_clock_diff_v1(numeric,numeric)', 'public.dr_wael_round_clock_v1(numeric)'] loop
    if has_function_privilege('anon', function_name, 'execute') or has_function_privilege('authenticated', function_name, 'execute') then
      raise exception 'helper_exposed: %', function_name;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.dr_wael_roaming_staff_v1', 'select')
     or has_table_privilege('authenticated', 'public.dr_wael_change_log_v1', 'select') then
    raise exception 'tables_exposed';
  end if;
end $$;
