-- «بصمات د وائل»: two read-only views the page needs to link punches to credit and to understand rotating shifts.
-- get_dr_wael_credit_ledger_v1: per employee, delivery discipline credit (from the payroll classification itself,
-- so the numbers are the ones payroll uses) and the missing-punch allowance of the cycle.
-- get_dr_wael_shift_patterns_v1: resolved days of the last 45 days in Cairo minutes; the page clusters them into
-- the shifts each employee really works.
-- Nothing is written. The app calls RPCs as anon with its own staff session, so both grants are needed;
-- dr_wael_fingerprints_actor_v1 is the access check.

create or replace function public.dr_wael_cairo_minutes_v1(p_at timestamptz)
returns int
language sql
immutable
set search_path = pg_catalog
as $$
  select (extract(hour from p_at at time zone 'Africa/Cairo') * 60
          + extract(minute from p_at at time zone 'Africa/Cairo'))::int;
$$;

create or replace function public.get_dr_wael_credit_ledger_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branches text[] := array['فرع شكري', 'فرع الشامي', 'المخزن'];
  v_cycle text := p_month_cycle;
  v_start date;
  v_end date;
  v_rows jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();
  if v_cycle is null then
    v_cycle := to_char(case when extract(day from v_today) >= 26 then v_today + interval '1 month' else v_today end, 'YYYY-MM');
  elsif v_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  v_end := to_date(v_cycle || '-25', 'YYYY-MM-DD');
  v_start := (v_end - interval '1 month')::date + 1;

  with st as (
    select s.id from public.staff s where s.is_active is true and s.branch = any(v_branches)
    union
    select a.staff_id from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end and a.branch = any(v_branches) and a.staff_id is not null
  ),
  classified as (
    select st.id as staff_id, public.dawaa_delivery_payroll_classification_v1(st.id, v_cycle) as c
    from st
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', k.staff_id,
      -- The incidents' month_cycle label changed format over time, so the cycle is taken from the date.
      'missing_used', (select count(*) from public.attendance_missing_punch_incidents i
                       where i.staff_id = k.staff_id and i.attendance_date between v_start and v_end),
      'missing_penalized', (select count(*) from public.attendance_missing_punch_incidents i
                            where i.staff_id = k.staff_id and i.attendance_date between v_start and v_end
                              and i.deduction_transaction_id is not null),
      'missing_open', (select count(*) from public.attendance_daily_summary a
                       where a.staff_id = k.staff_id and a.attendance_date between v_start and v_end
                         and a.status = 'pending_review' and a.resolution_status in ('missing_checkin', 'missing_checkout')
                         and not exists (select 1 from public.attendance_missing_punch_incidents i
                                         where i.staff_id = a.staff_id and i.attendance_date = a.attendance_date)),
      'delivery', case when coalesce((k.c->>'payroll_eligible')::boolean, false) then jsonb_build_object(
        'status', k.c#>>'{classification,status}',
        'band', k.c#>>'{classification,discipline_band}',
        'band_ar', k.c#>>'{classification,discipline_band_ar}',
        'attended_days', (k.c#>>'{attendance,attended_days}')::int,
        'minimum_days', (k.c#>>'{attendance,minimum_attended_days}')::int,
        'pending_days', (k.c#>>'{attendance,pending_review_days}')::int,
        'minutes', (k.c#>>'{discipline,classification_minutes}')::int,
        'late_minutes', (k.c#>>'{discipline,late_minutes}')::int,
        'early_minutes', (k.c#>>'{discipline,early_leave_minutes}')::int,
        'excused_minutes', (k.c#>>'{discipline,excused_permission_minutes}')::int,
        'committed_credit', (k.c#>>'{discipline,committed_credit_minutes}')::int,
        'regular_credit', (k.c#>>'{discipline,regular_credit_minutes}')::int,
        'committed_per_day', (k.c#>>'{discipline,committed_credit_per_attended_day}')::int,
        'regular_per_day', (k.c#>>'{discipline,regular_credit_per_attended_day}')::int,
        'days', (select coalesce(jsonb_agg(jsonb_build_object(
                    'date', e.attendance_date, 'minutes', e.discipline_minutes,
                    'late', e.late_minutes, 'early', e.early_leave_minutes, 'exempt', e.permission_exempt)
                  order by e.attendance_date), '[]'::jsonb)
                 from public.dawaa_delivery_discipline_evidence_v1(k.staff_id, v_cycle) e
                 where e.attended and e.late_minutes + e.early_leave_minutes > 0)
      ) end
    )), '[]'::jsonb)
    into v_rows
  from classified k;

  return jsonb_build_object(
    'month_cycle', v_cycle, 'cycle_start', v_start, 'cycle_end', v_end, 'today', v_today,
    'missing_limit', 2, 'missing_penalty', 50, 'rows', v_rows);
end;
$$;

create or replace function public.get_dr_wael_shift_patterns_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_samples jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();

  with days as (
    select distinct on (a.staff_id, a.attendance_date)
      a.staff_id, a.attendance_date, a.first_in, a.last_out, a.scheduled_start_at, a.scheduled_end_at,
      coalesce(a.late_minutes, 0) as late, coalesce(a.early_leave_minutes, 0) as early,
      a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%' as locked
    from public.attendance_daily_summary a
    join public.staff s on s.id = a.staff_id
      and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')
    where a.attendance_date between v_today - 45 and v_today - 1
      and a.first_in is not null and a.last_out is not null
      and a.last_out - a.first_in >= interval '3 hours'
    order by a.staff_id, a.attendance_date, a.updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', d.staff_id, 'date', d.attendance_date,
      'in', public.dr_wael_cairo_minutes_v1(d.first_in),
      'out', public.dr_wael_cairo_minutes_v1(d.last_out),
      'scheduled_in', public.dr_wael_cairo_minutes_v1(d.scheduled_start_at),
      'scheduled_out', public.dr_wael_cairo_minutes_v1(d.scheduled_end_at),
      'late', d.late, 'early', d.early, 'locked', d.locked)
    order by d.staff_id, d.attendance_date), '[]'::jsonb)
    into v_samples
  from days d;

  return jsonb_build_object('today', v_today, 'samples', v_samples);
end;
$$;

revoke all on function public.get_dr_wael_credit_ledger_v1(text) from public;
revoke all on function public.get_dr_wael_shift_patterns_v1() from public;
revoke all on function public.dr_wael_cairo_minutes_v1(timestamptz) from public, anon, authenticated;
grant execute on function public.get_dr_wael_credit_ledger_v1(text) to anon, authenticated;
grant execute on function public.get_dr_wael_shift_patterns_v1() to anon, authenticated;
