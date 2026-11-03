-- «بصمات د وائل»: only the listed viewer accounts read it, scoped to شكري / الشامي / المخزن and one pay cycle.
insert into public.dr_wael_fingerprints_viewers_v1(staff_account_id, label) values
  ('00000000-0000-4000-8000-000000000001', 'مشاهد'),
  ('00000000-0000-4000-8000-000000000003', 'مشاهد موقوف');

do $$
declare
  v jsonb;
  v_day jsonb;
begin
  -- The migration seeds exactly the general manager and Dr. Wael accounts.
  if (select count(*) from public.dr_wael_fingerprints_viewers_v1
      where staff_account_id in ('748fad73-5aab-4e61-bfd6-8be299af8aa9', 'e1454077-98eb-4f54-8fa8-2e4094991435')) <> 2 then
    raise exception 'viewers_not_seeded';
  end if;

  -- No session, another general manager (not on the list) and a suspended listed account are all refused.
  foreach v_day in array array['""', '"00000000-0000-4000-8000-000000000002"', '"00000000-0000-4000-8000-000000000003"']::jsonb[] loop
    perform set_config('test.actor', v_day #>> '{}', true);
    begin
      perform public.get_dr_wael_fingerprints_v1();
      raise exception 'read_allowed_for %', v_day;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.get_dr_wael_day_punches_v1(date '2026-11-01');
      raise exception 'punches_allowed_for %', v_day;
    exception when insufficient_privilege then null;
    end;
  end loop;

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_dr_wael_fingerprints_v1('2026-11');
  if v->>'cycle_start' <> '2026-10-26' or v->>'cycle_end' <> '2026-11-25'
     or v->'branches' <> '["فرع شكري", "فرع الشامي", "المخزن"]'::jsonb then
    raise exception 'cycle_wrong: %', v;
  end if;

  -- Active staff of the three branches + the former employee with a day here; never فرع زكريا.
  if jsonb_array_length(v->'employees') <> 5
     or exists (select 1 from jsonb_array_elements(v->'employees') e where e->>'branch' = 'فرع زكريا')
     or not exists (select 1 from jsonb_array_elements(v->'employees') e
                    where e->>'staff_id' = '00000000-0000-4000-9000-000000000006' and (e->>'active')::boolean is false)
     or not exists (select 1 from jsonb_array_elements(v->'employees') e
                    where e->>'staff_id' = '00000000-0000-4000-9000-000000000005' and (e->>'delivery')::boolean) then
    raise exception 'employees_wrong: %', v->'employees';
  end if;
  -- The week ending today comes from the schedule resolver: 7 days, Friday off.
  select e->'week' into v_day from jsonb_array_elements(v->'employees') e
  where e->>'staff_id' = '00000000-0000-4000-9000-000000000001';
  if jsonb_array_length(v_day) <> 7
     or (select count(*) from jsonb_array_elements(v_day) d where (d->>'off')::boolean) <> 1
     or exists (select 1 from jsonb_array_elements(v_day) d where d->>'start' <> '10:00:00' or not (d->>'scheduled')::boolean) then
    raise exception 'week_wrong: %', v_day;
  end if;

  -- Days inside the cycle and the three branches only, with the punch count of that Cairo day.
  if jsonb_array_length(v->'days') <> 4 then raise exception 'days_count: %', v->'days'; end if;
  select d into v_day from jsonb_array_elements(v->'days') d
  where d->>'staff_id' = '00000000-0000-4000-9000-000000000001' and d->>'date' = '2026-11-01';
  if (v_day->>'punches')::int <> 2 or (v_day->>'late_minutes')::int <> 10 or (v_day->>'review')::boolean then
    raise exception 'day_wrong: %', v_day;
  end if;
  select d into v_day from jsonb_array_elements(v->'days') d
  where d->>'staff_id' = '00000000-0000-4000-9000-000000000001' and d->>'date' = '2026-11-02';
  if not (v_day->>'review')::boolean or not (v_day->>'missing_punch')::boolean then
    raise exception 'review_day_wrong: %', v_day;
  end if;

  -- Time off of the scope (cancelled excluded), this cycle's incentive truth, money ledger rows and manual entries.
  if jsonb_array_length(v->'time_off') <> 1 then raise exception 'time_off_wrong: %', v->'time_off'; end if;
  if jsonb_array_length(v->'incentives') <> 1 or (v->'incentives'->0->>'automated_total')::numeric <> 500 then
    raise exception 'incentives_wrong: %', v->'incentives';
  end if;
  if jsonb_array_length(v->'movements') <> 2
     or exists (select 1 from jsonb_array_elements(v->'movements') m where m->>'status' = 'cancelled' or (m->>'amount')::numeric = 0) then
    raise exception 'movements_wrong: %', v->'movements';
  end if;
  if jsonb_array_length(v->'manual_entries') <> 1 or (v->'manual_entries'->0->>'signed_amount')::numeric <> -400 then
    raise exception 'manual_wrong: %', v->'manual_entries';
  end if;

  -- The previous cycle ends on 2026-10-25 and holds only that day; a malformed cycle is refused.
  v := public.get_dr_wael_fingerprints_v1('2026-10');
  if jsonb_array_length(v->'days') <> 1 or v->'days'->0->>'date' <> '2026-10-25'
     or (v->'incentives'->0->>'automated_total')::numeric <> 999 then
    raise exception 'october_wrong: %', v;
  end if;
  begin
    perform public.get_dr_wael_fingerprints_v1('2026-13');
    raise exception 'bad_cycle_allowed';
  exception when invalid_parameter_value then null;
  end;
  -- The default is the current cycle.
  v := public.get_dr_wael_fingerprints_v1();
  if v->>'month_cycle' !~ '^\d{4}-\d{2}$'
     or not ((v->>'today')::date between (v->>'cycle_start')::date and (v->>'cycle_end')::date) then
    raise exception 'default_cycle_wrong: %', v;
  end if;

  -- One day's punches: the scope's punches of that day and the night after it, never another branch.
  v := public.get_dr_wael_day_punches_v1(date '2026-11-01');
  if jsonb_array_length(v->'punches') <> 3
     or exists (select 1 from jsonb_array_elements(v->'punches') p where p->>'branch' = 'فرع زكريا')
     or v->'punches'->0->>'name' <> 'صيدلي شكري' then
    raise exception 'punches_wrong: %', v;
  end if;
  begin
    perform public.get_dr_wael_day_punches_v1((now() at time zone 'Africa/Cairo')::date + 1);
    raise exception 'future_day_allowed';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- The browser calls the reads only; the actor check, the viewer list and the tables stay closed.
do $$
begin
  if not has_function_privilege('anon', 'public.get_dr_wael_fingerprints_v1(text)', 'execute')
     or not has_function_privilege('anon', 'public.get_dr_wael_day_punches_v1(date)', 'execute') then
    raise exception 'reads_not_granted_to_anon';
  end if;
  if has_function_privilege('anon', 'public.dr_wael_fingerprints_actor_v1()', 'execute')
     or has_function_privilege('authenticated', 'public.dr_wael_fingerprints_actor_v1()', 'execute') then
    raise exception 'actor_check_exposed';
  end if;
  if has_table_privilege('anon', 'public.dr_wael_fingerprints_viewers_v1', 'select')
     or has_table_privilege('authenticated', 'public.dr_wael_fingerprints_viewers_v1', 'insert') then
    raise exception 'viewer_list_exposed';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.get_dr_wael_fingerprints_v1(text)'::regprocedure) is not true
     or (select provolatile from pg_proc where oid = 'public.get_dr_wael_fingerprints_v1(text)'::regprocedure) <> 's' then
    raise exception 'read_not_stable_definer';
  end if;
end;
$$;
