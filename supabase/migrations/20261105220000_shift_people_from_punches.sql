-- Who was on a shift, from the fingerprints (owner request 2026-11-05):
--   * assistants count too (the Shamy night and evening are often closed by an assistant), each with a kind;
--   * a schedule row stands in only for active staff and only when nobody punched (a doctor who left
--     no longer shows up from an old schedule);
--   * a closed shift is read at the moment it was really closed (the handover time), not the usual hour,
--     and everyone in the branch at that moment (in for an hour or more) counts.

create or replace function public.shift_on_duty_doctors_v1(p_branch text, p_close_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'name', x.name, 'role', x.role,
           'kind', x.kind, 'source', x.source, 'first_in', x.first_in, 'last_out', x.last_out)
           order by x.kind_order, x.start_at), '[]'::jsonb)
  from (
    select y.*, count(*) filter (where y.source = 'punch') over () as punched
    from (
      select distinct on (a.staff_id) a.staff_id, btrim(s.name) as name, s.role, k.kind, k.kind_order,
             case when a.first_in is not null or a.last_out is not null then 'punch' else 'schedule' end as source,
             a.first_in, a.last_out, coalesce(a.first_in, a.scheduled_start_at) as start_at,
             coalesce(s.is_active, false) as active
      from public.attendance_daily_summary a
      join public.staff s on s.id = a.staff_id
      cross join lateral (
        select case
          when lower(btrim(coalesce(s.role, ''))) in ('مدير فرع', 'branch_manager') then 'manager'
          when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 'assistant'
          when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 'doctor'
        end as kind,
        case
          when lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist') then 0
          when lower(btrim(coalesce(s.role, ''))) in ('assistant', 'مساعد صيدلي', 'مساعد') then 1
          else 2
        end as kind_order
      ) k
      where a.branch = p_branch
        and k.kind is not null
        and a.attendance_date between (p_close_at at time zone 'Africa/Cairo')::date - 1
                                  and (p_close_at at time zone 'Africa/Cairo')::date
        -- In the branch at the close: came in at least an hour before it (not someone just arriving)
        -- and still there within the hour before it.
        and coalesce(a.first_in, a.scheduled_start_at) <= p_close_at - interval '1 hour'
        and coalesce(a.last_out, a.scheduled_end_at, a.first_in + interval '12 hours') >= p_close_at - interval '1 hour'
      order by a.staff_id, a.attendance_date desc
    ) y
  ) x
  -- The schedule alone counts only when nobody punched, and only for someone still working here.
  where x.source = 'punch' or (x.punched = 0 and x.active);
$function$;
revoke all on function public.shift_on_duty_doctors_v1(text, timestamptz) from public, anon, authenticated;

create or replace function public.shift_handover_on_duty_v1(p_from date, p_to date)
returns table(branch text, shift_date date, shift_type text, close_at timestamptz, doctors jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.gm_daily_review_actor_v1();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 45 then raise exception 'invalid_range'; end if;
  return query
    select b.name, d.day::date, s.type, c.close_at, public.shift_on_duty_doctors_v1(b.name, c.close_at)
    from (values ('فرع شكري'), ('فرع الشامي')) b(name)
    cross join generate_series(p_from, p_to, interval '1 day') d(day)
    cross join (values ('ليلي', 8), ('صباحي', 17), ('مسائي', 25)) s(type, close_hour)
    cross join lateral (select (d.day::date::timestamp + make_interval(hours => s.close_hour))
                                 at time zone 'Africa/Cairo' as usual_close) x
    left join lateral (
      select min(coalesce(h.base44_created_at, h.recorded_at)) as closed_at
      from public.shift_handovers h
      where h.branch = b.name and h.shift_date = d.day::date and h.shift_type = s.type and not h.is_archived
    ) h on true
    -- The real close when the handover came in around the shift's end; the usual hour otherwise.
    cross join lateral (select case when h.closed_at between x.usual_close - interval '5 hours'
                                                          and x.usual_close + interval '5 hours'
                                    then h.closed_at else x.usual_close end as close_at) c
    order by d.day desc, b.name, s.close_hour;
end;
$function$;
revoke all on function public.shift_handover_on_duty_v1(date, date) from public, anon;
grant execute on function public.shift_handover_on_duty_v1(date, date) to authenticated;
