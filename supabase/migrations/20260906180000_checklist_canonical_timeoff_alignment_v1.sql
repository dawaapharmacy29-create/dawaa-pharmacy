-- Align checklist workday resolution with the canonical time-off domain introduced on main.
-- Approved full-day leave/absence must never produce checklist obligations or missed-task evidence.

begin;

create or replace function public.dawaa_staff_scheduled_workday_v1(
  p_staff_id uuid,
  p_target_date date
)
returns boolean
language plpgsql
stable
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_day_ar text;
  v_sched public.shift_schedules%rowtype;
  v_day_off text;
begin
  if p_staff_id is null or p_target_date is null then return false; end if;

  -- Canonical approved whole-day time off wins over the recurring weekly schedule.
  -- Permissions are intentionally excluded because they are partial-day events, and
  -- shift_swap does not itself mean the employee is off for the whole date.
  if exists(
    select 1
    from public.staff_time_off_requests r
    where r.staff_id=p_staff_id
      and r.status='approved'
      and r.request_kind in('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and p_target_date between r.start_date and r.end_date
  ) then
    return false;
  end if;

  v_day_ar:=case extract(dow from p_target_date)::int
    when 0 then 'الأحد'
    when 1 then 'الاثنين'
    when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء'
    when 4 then 'الخميس'
    when 5 then 'الجمعة'
    else 'السبت'
  end;

  select ss.* into v_sched
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id
    and trim(coalesce(ss.day_name,''))=v_day_ar
  order by ss.updated_at desc nulls last,ss.created_at desc nulls last,ss.id desc
  limit 1;

  if found then
    return not(coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false));
  end if;

  -- Historical fallback only when a weekly schedule row is unavailable.
  select nullif(trim(coalesce(s.day_off,'')),'')
  into v_day_off
  from public.staff s
  where s.id=p_staff_id;

  if v_day_off is not null and v_day_off=v_day_ar then return false; end if;
  return true;
end;
$$;

revoke all on function public.dawaa_staff_scheduled_workday_v1(uuid,date) from public;
grant execute on function public.dawaa_staff_scheduled_workday_v1(uuid,date) to anon,authenticated;

commit;
