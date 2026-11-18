-- dashboard_present_now_v1, paired over a week instead of 40 hours.
-- The 40-hour window often started in the middle of a shift: its first punch was yesterday's
-- departure, and pairing from there shifted every pair by one. So محمد عبد الرحمن's departure at
-- 10:41 (18/11) was read as a new arrival, and some arrivals were missed (د محمد شبل 14/11 23:17,
-- اسلام السبع 11/11 08:04). Reading the last 7 days lets the pairing start from a clean break.
-- A label that contradicts the pair (an accepted «out» opening it, «in» closing it) now costs as much
-- as leaving a punch alone, so a departure followed by the next arrival is not taken as a shift.
-- Same signature, result, guard and grants.
create or replace function public.dashboard_present_now_v1(p_at timestamptz default null)
returns table(staff_id uuid, staff_name text, role text, branch text, since timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_now timestamptz := coalesce(p_at, now());
  v_from timestamptz := v_now - interval '7 days';
  v_staff uuid;
  v_a timestamptz[];
  v_z timestamptz[];
  v_type text[];
  v_branch text[];
  v_n integer;
  v_cost numeric[];
  v_pair boolean[];
  v_i integer;
  v_d numeric;
  v_pc numeric;
  v_open boolean;
  r record;
begin
  perform public.gm_daily_review_actor_v1();
  for v_staff in
    select distinct b.staff_id from public.biometric_attendance_logs b
    where b.staff_id is not null and b.punch_time > v_now - interval '16 hours' and b.punch_time <= v_now
  loop
    v_a := '{}'; v_z := '{}'; v_type := '{}'; v_branch := '{}'; v_n := 0;
    for r in
      with p as (
        select b.punch_time, b.branch,
               -- The smart reading wins; the device label is only a fallback (some devices mislabel).
               coalesce(s.attendance_type, case when s.id is null then b.punch_type end) as ty
        from public.biometric_attendance_logs b
        left join lateral (
          select sl.id, sl.status, case when sl.status = 'accepted' then sl.attendance_type end as attendance_type
          from public.staff_attendance_logs sl
          where sl.biometric_source_log_id = b.id
          order by (sl.status = 'accepted') desc
          limit 1
        ) s on true
        where b.staff_id = v_staff and b.punch_time >= v_from and b.punch_time <= v_now
          and coalesce(s.status, '') <> 'rejected'
      ),
      marked as (
        select p.*, case when lag(p.punch_time) over (order by p.punch_time) is null
                          or p.punch_time - lag(p.punch_time) over (order by p.punch_time) > interval '10 minutes'
                         then 1 else 0 end as starts
        from p
      ),
      grouped as (select m.*, sum(m.starts) over (order by m.punch_time) as c from marked m)
      select min(g.punch_time) as a, max(g.punch_time) as z,
             case when bool_and(g.ty = 'check_out') then 'check_out'
                  when bool_and(g.ty = 'check_in') then 'check_in' end as ty,
             (array_agg(g.branch order by g.punch_time desc))[1] as br
      from grouped g group by g.c order by 1
    loop
      v_n := v_n + 1;
      v_a := v_a || r.a; v_z := v_z || r.z; v_type := v_type || r.ty; v_branch := v_branch || r.br;
    end loop;
    if v_n = 0 then continue; end if;

    -- Pairing like dawaa_unsummarized_punch_spans_v1 (cheapest split of the whole sequence), with the
    -- smart reading's labels weighing as much as a punch left alone.
    v_cost := array_fill(0::numeric, array[v_n + 2]);
    v_pair := array_fill(false, array[v_n + 1]);
    for v_i in reverse v_n..1 loop
      v_cost[v_i] := 1 + v_cost[v_i + 1];
      v_pair[v_i] := false;
      if v_i < v_n then
        v_d := extract(epoch from v_z[v_i + 1] - v_a[v_i]) / 3600;
        if v_d <= 16 then
          v_pc := case when v_d < 1 then 0.8 when v_d < 3 then 0.4 when v_d <= 13 then 0 else 0.2 end
                + case when v_type[v_i] = 'check_out' then 1 else 0 end
                + case when v_type[v_i + 1] = 'check_in' then 1 else 0 end;
          if v_pc + v_cost[v_i + 2] <= v_cost[v_i] then
            v_cost[v_i] := v_pc + v_cost[v_i + 2];
            v_pair[v_i] := true;
          end if;
        end if;
      end if;
    end loop;

    -- Walk to the last group: present only if it is an arrival left open.
    v_i := 1;
    v_open := false;
    while v_i <= v_n loop
      if v_pair[v_i] then
        v_open := false;
        v_i := v_i + 2;
      else
        v_open := v_i = v_n and coalesce(v_type[v_i], 'check_in') <> 'check_out'
                  and v_a[v_i] > v_now - interval '16 hours';
        v_i := v_i + 1;
      end if;
    end loop;

    if v_open then
      staff_id := v_staff;
      since := v_a[v_n];
      branch := v_branch[v_n];
      select s.name, s.role into staff_name, role from public.staff s where s.id = v_staff;
      return next;
    end if;
  end loop;
end;
$function$;

revoke all on function public.dashboard_present_now_v1(timestamptz) from public, anon;
grant execute on function public.dashboard_present_now_v1(timestamptz) to anon, authenticated, service_role;
