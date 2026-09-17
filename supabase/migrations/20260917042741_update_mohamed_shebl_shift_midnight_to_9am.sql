do $$
declare
  v_staff_id uuid;
  v_updated integer;
begin
  select id into v_staff_id
  from public.staff
  where name = 'د محمد شبل'
    and branch = 'فرع شكري'
    and coalesce(active, false) = true
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1;

  if v_staff_id is null then
    raise exception 'Canonical active staff record for د محمد شبل / فرع شكري was not found';
  end if;

  update public.shift_schedules
  set shift_start = '00:00:00',
      updated_at = now()
  where staff_id = v_staff_id
    and coalesce(is_off, false) = false
    and coalesce(is_day_off, false) = false
    and shift_start = '01:00:00'
    and shift_end = '09:00:00';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'No 01:00-09:00 working schedule rows found to update for د محمد شبل';
  end if;
end
$$;
