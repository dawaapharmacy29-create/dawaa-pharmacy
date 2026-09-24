-- Weekly-off swap decision bridge from Attendance Resolution Center.
-- A reviewed manager decision moves the weekly off inside the same Sat-Fri week,
-- writes explicit date overrides for both dates, audits the change, and rebuilds attendance truth.

create table if not exists public.attendance_weekly_off_swaps (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_name text not null,
  branch text,
  attendance_date date not null,
  swap_with_date date not null,
  attendance_override_id uuid references public.shift_schedules(id) on delete restrict,
  work_override_id uuid references public.shift_schedules(id) on delete restrict,
  previous_attendance_schedule jsonb not null default '{}'::jsonb,
  previous_swap_schedule jsonb not null default '{}'::jsonb,
  actor_id text,
  actor_name text,
  actor_role text,
  note text,
  created_at timestamptz not null default now(),
  unique(staff_id, attendance_date, swap_with_date),
  check (attendance_date <> swap_with_date)
);

alter table public.attendance_weekly_off_swaps enable row level security;
revoke all on public.attendance_weekly_off_swaps from public,anon,authenticated;
grant all on public.attendance_weekly_off_swaps to service_role;

create or replace function public.weekly_off_swap_preview_v1(
  p_staff_id uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_week_start date;
  v_week_end date;
  v_staff public.staff%rowtype;
  v_current record;
  v_candidates jsonb;
begin
  if p_staff_id is null or p_date is null then
    raise exception 'weekly_off_swap_preview_identity_or_date_missing' using errcode='22023';
  end if;
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_weekly_off_swap_preview' using errcode='42501';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  v_week_start := p_date - ((extract(dow from p_date)::int + 1) % 7);
  v_week_end := v_week_start + 6;

  select * into v_current
  from public.attendance_schedule_for_date_v1(p_staff_id,p_date)
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', q.schedule_date,
    'day_name', q.day_name,
    'schedule_id', q.schedule_id,
    'shift_start', q.shift_start,
    'shift_end', q.shift_end,
    'source_kind', q.source_kind
  ) order by q.schedule_date),'[]'::jsonb)
  into v_candidates
  from (
    select
      (v_week_start + g)::date as schedule_date,
      s.schedule_id,s.day_name,s.shift_start,s.shift_end,s.source_kind,s.is_off,s.is_day_off
    from generate_series(0,6) g
    join lateral public.attendance_schedule_for_date_v1(p_staff_id,(v_week_start + g)::date) s on true
    where (v_week_start + g)::date<>p_date
      and (coalesce(s.is_off,false) or coalesce(s.is_day_off,false))
  ) q;

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'staff_name',v_staff.name,
    'branch',v_staff.branch,
    'date',p_date,
    'week_start',v_week_start,
    'week_end',v_week_end,
    'current_schedule',case when v_current.schedule_id is null then null else jsonb_build_object(
      'schedule_id',v_current.schedule_id,
      'day_name',v_current.day_name,
      'shift_start',v_current.shift_start,
      'shift_end',v_current.shift_end,
      'is_off',v_current.is_off,
      'is_day_off',v_current.is_day_off,
      'source_kind',v_current.source_kind
    ) end,
    'off_day_candidates',v_candidates
  );
end;
$$;

create or replace function public.resolve_weekly_off_swap_from_attendance_v1(
  p_staff_id uuid,
  p_date date,
  p_swap_with_date date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text:=public.employee_operating_actor_role();
  v_week_start date;
  v_week_end date;
  v_current record;
  v_target record;
  v_current_snapshot jsonb;
  v_target_snapshot jsonb;
  v_current_overrides integer:=0;
  v_target_overrides integer:=0;
  v_attendance_override uuid;
  v_work_override uuid;
  v_swap public.attendance_weekly_off_swaps%rowtype;
  v_note text:=coalesce(nullif(trim(coalesce(p_note,'')),''),'تغيير يوم الراحة الأسبوعي من قرار الحضور');
  v_materialized jsonb;
  v_hours numeric;
begin
  if p_staff_id is null or p_date is null or p_swap_with_date is null then
    raise exception 'weekly_off_swap_identity_or_date_missing' using errcode='22023';
  end if;
  if p_date=p_swap_with_date then
    raise exception 'weekly_off_swap_dates_must_differ' using errcode='22023';
  end if;
  if not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_weekly_off_swap_decision' using errcode='42501';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  v_week_start := p_date - ((extract(dow from p_date)::int + 1) % 7);
  v_week_end := v_week_start + 6;
  if p_swap_with_date<v_week_start or p_swap_with_date>v_week_end then
    raise exception 'weekly_off_swap_must_be_within_same_week' using errcode='22023';
  end if;

  select * into v_swap
  from public.attendance_weekly_off_swaps
  where staff_id=p_staff_id and attendance_date=p_date and swap_with_date=p_swap_with_date;
  if found then
    return jsonb_build_object(
      'success',true,'already_applied',true,'swap_id',v_swap.id,
      'staff_id',p_staff_id,'staff_name',v_swap.staff_name,'branch',v_swap.branch,
      'date',p_date,'swap_with_date',p_swap_with_date,
      'attendance_override_id',v_swap.attendance_override_id,
      'work_override_id',v_swap.work_override_id
    );
  end if;

  select * into v_current from public.attendance_schedule_for_date_v1(p_staff_id,p_date) limit 1;
  if v_current.schedule_id is null then
    raise exception 'weekly_off_swap_current_day_has_no_schedule' using errcode='22023';
  end if;
  if coalesce(v_current.is_off,false) or coalesce(v_current.is_day_off,false) then
    raise exception 'weekly_off_swap_current_day_already_off' using errcode='22023';
  end if;
  if v_current.shift_start is null or v_current.shift_end is null then
    raise exception 'weekly_off_swap_current_shift_time_missing' using errcode='22023';
  end if;

  select * into v_target from public.attendance_schedule_for_date_v1(p_staff_id,p_swap_with_date) limit 1;
  if v_target.schedule_id is null then
    raise exception 'weekly_off_swap_target_day_has_no_schedule' using errcode='22023';
  end if;
  if not (coalesce(v_target.is_off,false) or coalesce(v_target.is_day_off,false)) then
    raise exception 'weekly_off_swap_target_must_be_existing_off_day' using errcode='22023';
  end if;

  if exists (
    select 1 from public.staff_time_off_requests r
    where r.staff_id=p_staff_id and r.status='approved'
      and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and (p_date between r.start_date and r.end_date or p_swap_with_date between r.start_date and r.end_date)
  ) then
    raise exception 'weekly_off_swap_conflicts_with_approved_time_off' using errcode='55000';
  end if;

  v_current_snapshot:=to_jsonb(v_current);
  v_target_snapshot:=to_jsonb(v_target);

  select count(*)::int into v_current_overrides
  from public.shift_schedules
  where staff_id=p_staff_id and coalesce(shift_date,date)=p_date;

  select count(*)::int into v_target_overrides
  from public.shift_schedules
  where staff_id=p_staff_id and coalesce(shift_date,date)=p_swap_with_date;

  if v_current_overrides>1 or v_target_overrides>1 then
    raise exception 'weekly_off_swap_existing_override_conflict' using errcode='55000';
  end if;

  v_hours:=round((
    extract(epoch from (
      (timestamp '2000-01-01'+v_current.shift_end)
      - (timestamp '2000-01-01'+v_current.shift_start)
      + case when v_current.shift_end<=v_current.shift_start then interval '1 day' else interval '0 day' end
    ))/3600.0
  )::numeric,2);

  if v_current_overrides=1 then
    update public.shift_schedules
    set staff_name=v_staff.name,employee_name=v_staff.name,role=v_staff.role,branch=v_staff.branch,
        day_name=case extract(dow from p_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end,
        shift_start=null,shift_end=null,start_time=null,end_time=null,hours=0,
        is_off=true,is_day_off=true,is_different=true,has_custom_time=false,
        shift_date=p_date,date=p_date,status='scheduled',source='attendance_weekly_off_swap_v1',
        notes=concat_ws(' | ',nullif(notes,''),v_note),effective_from=p_date,effective_to=p_date,updated_at=now()
    where staff_id=p_staff_id and coalesce(shift_date,date)=p_date
    returning id into v_attendance_override;
  else
    insert into public.shift_schedules(
      staff_id,staff_name,employee_name,role,branch,day_name,shift_start,shift_end,hours,
      is_off,is_day_off,is_different,has_custom_time,shift_date,date,status,source,notes,effective_from,effective_to
    ) values(
      p_staff_id,v_staff.name,v_staff.name,v_staff.role,v_staff.branch,
      case extract(dow from p_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end,
      null,null,0,true,true,true,false,p_date,p_date,'scheduled','attendance_weekly_off_swap_v1',v_note,p_date,p_date
    ) returning id into v_attendance_override;
  end if;

  if v_target_overrides=1 then
    update public.shift_schedules
    set staff_name=v_staff.name,employee_name=v_staff.name,role=v_staff.role,branch=v_staff.branch,
        day_name=case extract(dow from p_swap_with_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end,
        shift_start=to_char(v_current.shift_start,'HH24:MI'),shift_end=to_char(v_current.shift_end,'HH24:MI'),
        start_time=v_current.shift_start,end_time=v_current.shift_end,hours=v_hours,
        is_off=false,is_day_off=false,is_different=true,has_custom_time=true,
        shift_date=p_swap_with_date,date=p_swap_with_date,status='scheduled',source='attendance_weekly_off_swap_v1',
        notes=concat_ws(' | ',nullif(notes,''),v_note),effective_from=p_swap_with_date,effective_to=p_swap_with_date,updated_at=now()
    where staff_id=p_staff_id and coalesce(shift_date,date)=p_swap_with_date
    returning id into v_work_override;
  else
    insert into public.shift_schedules(
      staff_id,staff_name,employee_name,role,branch,day_name,shift_start,shift_end,start_time,end_time,hours,
      is_off,is_day_off,is_different,has_custom_time,shift_date,date,status,source,notes,effective_from,effective_to
    ) values(
      p_staff_id,v_staff.name,v_staff.name,v_staff.role,v_staff.branch,
      case extract(dow from p_swap_with_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end,
      to_char(v_current.shift_start,'HH24:MI'),to_char(v_current.shift_end,'HH24:MI'),
      v_current.shift_start,v_current.shift_end,v_hours,
      false,false,true,true,p_swap_with_date,p_swap_with_date,'scheduled','attendance_weekly_off_swap_v1',v_note,p_swap_with_date,p_swap_with_date
    ) returning id into v_work_override;
  end if;

  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

  insert into public.attendance_weekly_off_swaps(
    staff_id,staff_name,branch,attendance_date,swap_with_date,
    attendance_override_id,work_override_id,previous_attendance_schedule,previous_swap_schedule,
    actor_id,actor_name,actor_role,note
  ) values(
    p_staff_id,v_staff.name,v_staff.branch,p_date,p_swap_with_date,
    v_attendance_override,v_work_override,v_current_snapshot,v_target_snapshot,
    v_actor_id,v_actor_name,v_actor_role,v_note
  ) returning * into v_swap;

  v_materialized:=public.dawaa_materialize_attendance_range_internal_v2(
    least(p_date,p_swap_with_date),greatest(p_date,p_swap_with_date),v_staff.branch
  );

  return jsonb_build_object(
    'success',true,'already_applied',false,'swap_id',v_swap.id,
    'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,
    'date',p_date,'swap_with_date',p_swap_with_date,
    'attendance_override_id',v_attendance_override,'work_override_id',v_work_override,
    'attendance_materialization',coalesce(v_materialized,'{}'::jsonb)
  );
end;
$$;

revoke execute on function public.weekly_off_swap_preview_v1(uuid,date) from public;
revoke execute on function public.resolve_weekly_off_swap_from_attendance_v1(uuid,date,date,text) from public;
grant execute on function public.weekly_off_swap_preview_v1(uuid,date) to anon,authenticated,service_role;
grant execute on function public.resolve_weekly_off_swap_from_attendance_v1(uuid,date,date,text) to anon,authenticated,service_role;
