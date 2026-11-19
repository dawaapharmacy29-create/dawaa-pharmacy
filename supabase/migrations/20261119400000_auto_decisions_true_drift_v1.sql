-- The morning job (20261119300000) left every day of 10 employees to the page because their punches moved from the
-- schedule 3 times in 4 weeks. Most of them just came late or left late on some days. It now uses the same test as
-- the page (shiftDrift in src/lib/drWaelFingerprints.ts): over 4 weeks, at least 5 days and 60% of them keep one
-- other shift, arrival and leaving moved together by 20+ minutes and 30 on average. Only those employees wait for
-- the manager to move their shift; the others' days are decided like everyone's.
do $migration$
declare
  v_def text := pg_get_functiondef('public.dr_wael_auto_decisions_v1(integer)'::regprocedure);
  v_old text := $old$    with drifting as (
      select a.staff_id
      from public.attendance_daily_summary a
      where a.attendance_date >= v_today - 28 and a.first_in is not null and a.last_out is not null
        and a.scheduled_start_at is not null and a.scheduled_end_at is not null
        and abs(extract(epoch from (a.first_in - a.scheduled_start_at))) >= 30 * 60
        and abs(extract(epoch from (a.last_out - a.scheduled_end_at))) >= 30 * 60
        and sign(extract(epoch from (a.first_in - a.scheduled_start_at)))
          = sign(extract(epoch from (a.last_out - a.scheduled_end_at)))
      group by a.staff_id having count(*) >= 3
    )$old$;
  v_new text := $new$    with r as (
      select a.staff_id, a.attendance_date d,
        extract(hour from a.first_in at time zone 'Africa/Cairo') * 60 + extract(minute from a.first_in at time zone 'Africa/Cairo') i,
        extract(hour from a.last_out at time zone 'Africa/Cairo') * 60 + extract(minute from a.last_out at time zone 'Africa/Cairo') o,
        extract(hour from a.scheduled_start_at at time zone 'Africa/Cairo') * 60 + extract(minute from a.scheduled_start_at at time zone 'Africa/Cairo') si,
        extract(hour from a.scheduled_end_at at time zone 'Africa/Cairo') * 60 + extract(minute from a.scheduled_end_at at time zone 'Africa/Cairo') so
      from public.attendance_daily_summary a
      where a.attendance_date >= v_today - 28 and a.first_in is not null and a.last_out is not null
        and a.scheduled_start_at is not null and a.scheduled_end_at is not null
    ), plan as (
      select distinct on (staff_id) staff_id, si pi, so po from r order by staff_id, d desc
    ), off as (
      select r.staff_id, (((r.i - p.pi)::int % 1440 + 2160) % 1440) - 720 oi, (((r.o - p.po)::int % 1440 + 2160) % 1440) - 720 oo
      from r join plan p using (staff_id)
    ), ks as (
      select o.staff_id, k, count(*) n from off o, generate_series(-240, 240, 15) k
      where abs(o.oi - k) <= 45 and abs(o.oo - k) <= 45 group by 1, 2
    ), best as (
      select distinct on (staff_id) staff_id, k, n from ks order by staff_id, n desc, k
    ), med as (
      select b.staff_id, b.n, (select count(*) from off t where t.staff_id = b.staff_id) total,
        percentile_cont(0.5) within group (order by o.oi) mi, percentile_cont(0.5) within group (order by o.oo) mo
      from best b join off o on o.staff_id = b.staff_id and abs(o.oi - b.k) <= 45 and abs(o.oo - b.k) <= 45
      group by b.staff_id, b.n
    ), drifting as (
      select staff_id from med
      where n >= 5 and n::numeric / total >= 0.6 and abs(mi) >= 20 and abs(mo) >= 20 and sign(mi) = sign(mo)
        and abs(mi + mo) / 2 >= 30 and abs(mi - mo) <= 45
    )$new$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'dr_wael_auto_decisions_v1 is not the expected version';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
