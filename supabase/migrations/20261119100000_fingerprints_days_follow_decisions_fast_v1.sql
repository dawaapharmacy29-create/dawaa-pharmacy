-- The fingerprints page decides the clear days and overtime on its own (19/11/2026), so what it decides has to stay
-- in step with what the manager records, and fast:
--   * a leave recorded for an active employee left its past days waiting for a decision. dr_wael_set_leave_v1 rebuilt
--     them only for inactive staff and left the rest to the dirty queue. It now rebuilds them at once, and a day the
--     quick decisions closed as «غياب» gives way to the leave (an annual-leave day is paid, an absence is not);
--   * the dirty queue (attendance-dirty-queue-v1) took 3 days every 5 minutes. With 210 days waiting, a leave showed
--     on the page about 6 hours later. 40 days take about 5 s, so it now takes 40 every 2 minutes;
--   * an empty day marked worked_on_off (no shift, no punch) could not be closed from the quick decisions;
--   * overtime the manager asked for: the days are written down first, and their overtime is approved on its own
--     while any other overtime with a colleague of the same group around is rejected.

-- 1. A leave rebuilds its days up to today right away, for every employee, over a quick «غياب».
do $migration$
declare
  v_def text := pg_get_functiondef('public.dr_wael_set_leave_v1(uuid,text,date,date,text)'::regprocedure);
  v_old text := $old$  if exists (select 1 from public.staff s where s.id = p_staff_id and coalesce(s.active, false) = false) then
    for v_date in$old$;
  v_new text := $new$  -- A day closed as «غياب» by a quick decision gives way to the leave.
  update public.attendance_daily_summary a
  set status = 'pending_review', approved_by = 'system:reopened_for_leave', updated_at = now()
  where a.staff_id = p_staff_id
    and a.attendance_date between v_decided.start_date and least(v_decided.end_date, v_today)
    and a.status = 'approved' and coalesce(a.approval_note, '') like 'قرار سريع: غياب%';
  -- Every day of the leave up to today is rebuilt now, so it leaves the open decisions at once.
  if true then
    for v_date in$new$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'dr_wael_set_leave_v1 is not the expected version';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

-- 2. An empty worked_on_off day closes «as is» from the quick decisions: 0 hours, nothing to deduct.
do $migration$
declare
  v_def text := pg_get_functiondef('public.dr_wael_quick_day_decision_v1(uuid,date,text)'::regprocedure);
  v_old text := $old$    if v_day.resolution_status not in ('late', 'early_leave_review', 'off_day', 'no_schedule', 'approved_time_off')
       or (v_day.resolution_status in ('late', 'early_leave_review') and (v_day.first_in is null or v_day.last_out is null)) then$old$;
  v_new text := $new$    if v_day.resolution_status not in ('late', 'early_leave_review', 'off_day', 'no_schedule', 'approved_time_off', 'worked_on_off')
       or (v_day.resolution_status in ('late', 'early_leave_review') and (v_day.first_in is null or v_day.last_out is null))
       or (v_day.resolution_status = 'worked_on_off' and (v_day.first_in is not null or v_day.last_out is not null)) then$new$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'dr_wael_quick_day_decision_v1 is not the expected version';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

-- 3. The dirty queue: 40 days every 2 minutes instead of 3 every 5.
select cron.schedule('attendance-dirty-queue-v1', '*/2 * * * *',
  'select public.dawaa_process_attendance_dirty_queue_v1(40);');

-- 4. Overtime the manager asked for.
create table if not exists public.dr_wael_overtime_requests_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  check (to_date >= from_date and to_date - from_date <= 62)
);
create index if not exists dr_wael_overtime_requests_v1_staff_idx
  on public.dr_wael_overtime_requests_v1 (staff_id, from_date, to_date) where cancelled_at is null;
alter table public.dr_wael_overtime_requests_v1 enable row level security;
revoke all on public.dr_wael_overtime_requests_v1 from public, anon, authenticated;

create or replace function public.dr_wael_set_overtime_request_v1(p_staff_id uuid, p_from date, p_to date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_id uuid;
begin
  if p_staff_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62
     or p_from < v_today - 62 or p_to > v_today + 62 then
    raise exception 'invalid_overtime_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id) then
    raise exception 'staff_not_found' using errcode = '22023';
  end if;
  insert into public.dr_wael_overtime_requests_v1(staff_id, from_date, to_date, note, created_by)
  values (p_staff_id, p_from, p_to, nullif(left(trim(coalesce(p_note, '')), 300), ''), v_actor)
  returning id into v_id;
  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('overtime_request', p_staff_id, jsonb_build_object('id', v_id, 'from', p_from, 'to', p_to, 'note', p_note), v_actor);
  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.dr_wael_cancel_overtime_request_v1(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
begin
  update public.dr_wael_overtime_requests_v1
  set cancelled_at = now(), cancelled_by = v_actor
  where id = p_id and cancelled_at is null;
  return jsonb_build_object('success', found);
end;
$function$;

create or replace function public.get_dr_wael_overtime_requests_v1(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.dr_wael_fingerprints_actor_v1();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'staff_id', r.staff_id, 'from_date', r.from_date,
      'to_date', r.to_date, 'note', r.note) order by r.from_date desc)
    from public.dr_wael_overtime_requests_v1 r
    where r.cancelled_at is null and r.from_date <= p_to and r.to_date >= p_from), '[]'::jsonb);
end;
$function$;
