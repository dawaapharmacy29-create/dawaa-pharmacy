-- Punches no daily summary covers (staff without a schedule, e.g. د وائل), paired into shifts for
-- «تسليم الشيفتات». The old grouping only split a person's punches after a 12-hour gap, so a night shift
-- (00:01 → 10:02) and the evening that followed 11½ hours later (21:32 → 00:48) became one 25-hour
-- span. Now, by time only (the devices' in/out labels are not reliable: one branch labels every punch):
--   * taps under 10 minutes apart are one punch: a shift starts at the first tap and ends at the last;
--   * each person's punches are paired in order, choosing the most plausible split of the whole
--     sequence: 3–13 hours is a shift, up to 16 hours a double shift, under 3 hours unlikely, and a punch
--     left alone costs the most; a label that contradicts the pair («out» starting it, «in» ending it)
--     costs a little. So 8 pm → 4 am the next day is one shift, and a forgotten checkout does not take
--     the next shift's check-in as its own;
--   * punches up to 16 hours outside the range are read too, so a shift crossing its edge stays whole.
-- Same signature, result and grants as before.

create or replace function public.dawaa_unsummarized_punch_spans_v1(p_from timestamptz, p_to timestamptz)
returns table(staff_id uuid, first_in timestamptz, last_out timestamptz, branches text[])
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_from timestamptz := p_from - interval '16 hours';
  v_to timestamptz := p_to + interval '16 hours';
  v_staff uuid;
  v_a timestamptz[];
  v_z timestamptz[];
  v_taps integer[];
  v_type text[];
  v_n integer;
  v_cost numeric[];
  v_pair boolean[];
  v_i integer;
  v_d numeric;
  v_pc numeric;
  r record;
begin
  for v_staff in
    select distinct b.staff_id from public.biometric_attendance_logs b
    where b.staff_id is not null and b.punch_time >= p_from and b.punch_time < p_to
  loop
    v_a := '{}'; v_z := '{}'; v_taps := '{}'; v_type := '{}'; v_n := 0;
    for r in
      with free as (
        select b.punch_time, b.punch_type
        from public.biometric_attendance_logs b
        where b.staff_id = v_staff and b.punch_time >= v_from and b.punch_time < v_to
          and not exists (
            select 1 from public.attendance_daily_summary a
            where a.staff_id = b.staff_id
              and (a.first_in is not null or a.last_out is not null)
              and a.attendance_date between (b.punch_time at time zone 'Africa/Cairo')::date - 1
                                        and (b.punch_time at time zone 'Africa/Cairo')::date + 1
              and b.punch_time between coalesce(a.first_in, a.last_out - interval '16 hours') - interval '5 minutes'
                                   and coalesce(a.last_out, a.first_in + interval '16 hours') + interval '5 minutes')
      ),
      marked as (
        select f.*, case when lag(f.punch_time) over (order by f.punch_time) is null
                          or f.punch_time - lag(f.punch_time) over (order by f.punch_time) > interval '10 minutes'
                         then 1 else 0 end as starts
        from free f
      ),
      grouped as (select m.*, sum(m.starts) over (order by m.punch_time) as c from marked m)
      select min(g.punch_time) as a, max(g.punch_time) as z, count(*)::integer as taps,
             case when bool_and(g.punch_type = 'check_out') then 'check_out'
                  when bool_and(g.punch_type = 'check_in') then 'check_in' end as ty
      from grouped g group by g.c order by 1
    loop
      v_n := v_n + 1;
      v_a := v_a || r.a; v_z := v_z || r.z; v_taps := v_taps || r.taps; v_type := v_type || r.ty;
    end loop;
    if v_n = 0 then continue; end if;

    -- Cheapest split from punch i to the end: alone, or paired with the next one.
    v_cost := array_fill(0::numeric, array[v_n + 2]);
    v_pair := array_fill(false, array[v_n + 1]);
    for v_i in reverse v_n..1 loop
      v_cost[v_i] := 1 + v_cost[v_i + 1];
      v_pair[v_i] := false;
      if v_i < v_n then
        v_d := extract(epoch from v_z[v_i + 1] - v_a[v_i]) / 3600;
        if v_d <= 16 then
          v_pc := case when v_d < 1 then 0.8 when v_d < 3 then 0.4 when v_d <= 13 then 0 else 0.2 end
                + case when v_type[v_i] = 'check_out' then 0.25 else 0 end
                + case when v_type[v_i + 1] = 'check_in' then 0.25 else 0 end;
          if v_pc + v_cost[v_i + 2] <= v_cost[v_i] then
            v_cost[v_i] := v_pc + v_cost[v_i + 2];
            v_pair[v_i] := true;
          end if;
        end if;
      end if;
    end loop;

    v_i := 1;
    while v_i <= v_n loop
      staff_id := v_staff;
      if v_pair[v_i] then
        first_in := v_a[v_i];
        last_out := v_z[v_i + 1];
        v_i := v_i + 2;
      elsif v_taps[v_i] = 1 and v_type[v_i] = 'check_out' then
        -- A single punch: its label is the only hint whether it was an arrival or a departure.
        first_in := null;
        last_out := v_z[v_i];
        v_i := v_i + 1;
      elsif v_taps[v_i] = 1 then
        first_in := v_a[v_i];
        last_out := null;
        v_i := v_i + 1;
      else
        -- A lone double tap, read as before: in and out at that moment.
        first_in := v_a[v_i];
        last_out := v_z[v_i];
        v_i := v_i + 1;
      end if;
      if coalesce(first_in, last_out) >= p_to or coalesce(last_out, first_in) < p_from then
        continue;
      end if;
      select coalesce(array_agg(distinct b.branch) filter (where b.branch is not null), '{}'::text[])
        into branches
      from public.biometric_attendance_logs b
      where b.staff_id = v_staff
        and b.punch_time between coalesce(first_in, last_out) - interval '1 second'
                             and coalesce(last_out, first_in) + interval '1 second';
      return next;
    end loop;
  end loop;
end;
$function$;

revoke all on function public.dawaa_unsummarized_punch_spans_v1(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dawaa_unsummarized_punch_spans_v1(timestamptz, timestamptz) to service_role;
