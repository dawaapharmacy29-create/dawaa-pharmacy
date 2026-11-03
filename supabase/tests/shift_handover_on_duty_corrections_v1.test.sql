-- Who was on duty at each closing, and local corrections of a handover.
do $$
declare
  v jsonb;
  v_item jsonb;
  v_id uuid;
  v_names text;
begin
  -- The doctors behind each Shokry close on 1 Nov.
  select string_agg(d->>'name', '،' order by o) into v_names
  from jsonb_array_elements(public.shift_on_duty_doctors_v1('فرع شكري', timestamptz '2026-11-01 08:00+02')) with ordinality e(d, o);
  if v_names is distinct from 'د ليلي' then raise exception 'night_on_duty: %', v_names; end if;

  select string_agg(d->>'name', '،' order by o) into v_names
  from jsonb_array_elements(public.shift_on_duty_doctors_v1('فرع شكري', timestamptz '2026-11-01 17:00+02')) with ordinality e(d, o);
  -- Pharmacists first, the manager last; the delivery man and the schedule-only doctor are left out.
  if v_names is distinct from 'د صباحي،د مديرة' then raise exception 'morning_on_duty: %', v_names; end if;

  select string_agg(d->>'name', '،' order by o) into v_names
  from jsonb_array_elements(public.shift_on_duty_doctors_v1('فرع شكري', timestamptz '2026-11-02 01:00+02')) with ordinality e(d, o);
  if v_names is distinct from 'د مسائي' then raise exception 'evening_on_duty: %', v_names; end if;

  v := public.shift_on_duty_doctors_v1('فرع الشامي', timestamptz '2026-11-01 08:00+02');
  if jsonb_array_length(v) <> 1 or v->0->>'source' <> 'schedule' or v->0->>'name' <> 'د جدول' then
    raise exception 'schedule_fallback: %', v;
  end if;

  -- The range RPC: general manager only, both branches × three shifts a day.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.shift_handover_on_duty_v1('2026-11-01', '2026-11-01');
    raise exception 'branch_manager_read_on_duty';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  if (select count(*) from public.shift_handover_on_duty_v1('2026-10-31', '2026-11-01')) <> 12 then
    raise exception 'on_duty_rows';
  end if;
  if (select doctors->0->>'name' from public.shift_handover_on_duty_v1('2026-11-01', '2026-11-01')
       where branch = 'فرع شكري' and shift_type = 'مسائي') <> 'د مسائي' then
    raise exception 'on_duty_evening_close';
  end if;
  begin
    perform public.shift_handover_on_duty_v1('2026-09-01', '2026-11-01');
    raise exception 'long_range_allowed';
  exception when raise_exception then
    if sqlerrm <> 'invalid_range' then raise; end if;
  end;

  -- Corrections: a reason is required, only known fields, numbers stay numbers.
  perform public.import_base44_shift_deliveries_v1(jsonb_build_array(jsonb_build_object('id', 'fix-1',
    'branch', 'فرع شكري', 'shift_type', 'صباحي', 'shift_date', '2026-11-01', 'submitted_by', 'د غلط',
    'total_sales', 1000, 'net_amount', 900, 'cash_variance', -50)));
  select id into v_id from public.shift_handovers where base44_id = 'fix-1';
  begin
    perform public.correct_shift_handover_v1(v_id, '{"net_amount": 950}', ' ');
    raise exception 'no_reason_allowed';
  exception when raise_exception then if sqlerrm <> 'reason_required' then raise; end if;
  end;
  begin
    perform public.correct_shift_handover_v1(v_id, '{"branch": "فرع الشامي"}', 'غلط');
    raise exception 'branch_change_allowed';
  exception when raise_exception then if sqlerrm <> 'invalid_field' then raise; end if;
  end;
  begin
    perform public.correct_shift_handover_v1(v_id, '{"net_amount": "950"}', 'غلط');
    raise exception 'text_amount_allowed';
  exception when raise_exception then if sqlerrm <> 'invalid_amount' then raise; end if;
  end;

  v := public.correct_shift_handover_v1(v_id, '{"submitted_by": "د صباحي", "cash_variance": 0}', 'الدكتور اتسجل غلط');
  if v->>'submitted_by' <> 'د صباحي' or (v->>'cash_variance')::numeric <> 0 or (v->>'net_amount')::numeric <> 900 then
    raise exception 'correction_result: %', v;
  end if;
  -- A second correction records the first correction's value as the previous one.
  perform public.correct_shift_handover_v1(v_id, '{"cash_variance": -20}', 'الفرق الحقيقي 20');
  -- Both corrections share now() inside this transaction, so pick the second one by its reason.
  if (select previous->>'cash_variance' from public.shift_handover_corrections_v1
       where handover_id = v_id and reason = 'الفرق الحقيقي 20') <> '0' then
    raise exception 'previous_wrong';
  end if;
  if (select previous->>'submitted_by' from public.shift_handover_corrections_v1
       where handover_id = v_id and changes ? 'submitted_by') <> 'د غلط' then
    raise exception 'first_previous_wrong';
  end if;

  -- The sync keeps the Base44 values; the corrections sit beside them.
  perform public.import_base44_shift_deliveries_v1(jsonb_build_array(jsonb_build_object('id', 'fix-1',
    'branch', 'فرع شكري', 'shift_type', 'صباحي', 'shift_date', '2026-11-01', 'submitted_by', 'د غلط',
    'total_sales', 1000, 'net_amount', 900, 'cash_variance', -50)));
  if (select count(*) from public.shift_handover_corrections_v1 where handover_id = v_id) <> 2
     or (select submitted_by from public.shift_handovers where id = v_id) <> 'د غلط' then
    raise exception 'sync_touched_corrections';
  end if;

  -- A branch manager cannot correct.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.correct_shift_handover_v1(v_id, '{"notes": "x"}', 'x');
    raise exception 'branch_manager_corrected';
  exception when insufficient_privilege then null;
  end;

  -- The review item names the doctors on duty at each missing closing.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'shifts';
  if jsonb_typeof(v_item->'detail'->'branches'->0->'missing'->0->'doctors') <> 'array' then
    raise exception 'missing_without_doctors: %', v_item;
  end if;
end;
$$;

-- The browser reads the corrections and never writes them, and cannot call the internal helper.
set role authenticated;
do $$
begin
  perform count(*) from public.shift_handover_corrections_v1;
  begin
    insert into public.shift_handover_corrections_v1(handover_id, changes, previous, reason)
    select id, '{}', '{}', 'x' from public.shift_handovers limit 1;
    raise exception 'browser_wrote_correction';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.shift_on_duty_doctors_v1('فرع شكري', now());
    raise exception 'helper_exposed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
