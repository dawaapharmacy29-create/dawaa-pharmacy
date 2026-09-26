alter table public.shift_schedules add column if not exists effective_from date;
alter table public.shift_schedules add column if not exists effective_to date;

update public.shift_schedules
set effective_from = case
  when coalesce(shift_date,date) is not null then coalesce(shift_date,date)
  else coalesce((created_at at time zone 'Africa/Cairo')::date, date '2026-08-01')
end
where effective_from is null;

alter table public.shift_schedules alter column effective_from set not null;

alter table public.shift_schedules drop constraint if exists shift_schedules_effective_range_chk;
alter table public.shift_schedules add constraint shift_schedules_effective_range_chk
  check (effective_to is null or effective_to >= effective_from);

drop index if exists public.uq_shift_schedules_staff_day;
create unique index if not exists uq_shift_schedules_staff_day_active_v2
  on public.shift_schedules(staff_id,day_name)
  where staff_id is not null and day_name is not null
    and shift_date is null and date is null and effective_to is null;

create index if not exists idx_shift_schedules_staff_day_effective_v2
  on public.shift_schedules(staff_id,day_name,effective_from,effective_to);

create or replace function public.attendance_schedule_for_date_v1(
  p_staff_id uuid,
  p_date date
)
returns table(
  schedule_id uuid,
  staff_id uuid,
  branch text,
  day_name text,
  shift_start time,
  shift_end time,
  is_off boolean,
  is_day_off boolean,
  source_kind text
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  with d as (
    select case extract(dow from p_date)::int
      when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
      when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
      else 'السبت' end as day_ar
  )
  select
    ss.id,ss.staff_id,ss.branch,
    coalesce(nullif(trim(ss.day_name),''),(select day_ar from d)),
    case when trim(coalesce(ss.shift_start,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_start)::time else ss.start_time end,
    case when trim(coalesce(ss.shift_end,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_end)::time else ss.end_time end,
    coalesce(ss.is_off,false),coalesce(ss.is_day_off,false),
    case when coalesce(ss.shift_date,ss.date)=p_date then 'date_override' else 'weekly' end
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id
    and ss.effective_from<=p_date
    and (ss.effective_to is null or ss.effective_to>=p_date)
    and (
      coalesce(ss.shift_date,ss.date)=p_date
      or (
        ss.shift_date is null and ss.date is null
        and trim(coalesce(ss.day_name,''))=(select day_ar from d)
      )
    )
  order by (coalesce(ss.shift_date,ss.date)=p_date) desc,
           ss.effective_from desc,
           coalesce(ss.updated_at,ss.created_at) desc nulls last,
           ss.id desc
  limit 1;
$$;

create or replace function public.replace_staff_shift_schedule_version_v1(
  p_staff_id uuid,
  p_rows jsonb,
  p_effective_from date default ((now() at time zone 'Africa/Cairo')::date),
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_row jsonb;
  v_day text;
  v_count integer:=0;
begin
  if p_staff_id is null or p_effective_from is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'invalid_schedule_version_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select * into v_staff from public.staff s
  where s.id=p_staff_id and coalesce(s.active,s.is_active,true);
  if not found then raise exception 'target_staff_not_found_or_inactive' using errcode='22023'; end if;

  if coalesce(v_actor.role,'') not in ('general_manager','executive_manager','branches_manager','branch_manager') then
    raise exception 'not_authorized_for_schedule_write' using errcode='42501';
  end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_staff.branch,'')) then
    raise exception 'branch_manager_cross_branch_schedule_write_blocked' using errcode='42501';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_day:=nullif(trim(v_row->>'day_name'),'');
    if v_day is null then continue; end if;

    update public.shift_schedules
    set effective_to=p_effective_from-1,
        notes=concat_ws(' | ',nullif(notes,''),coalesce(nullif(trim(p_note),''),'تم إغلاق النسخة السابقة تلقائيًا'))
    where staff_id=p_staff_id
      and day_name=v_day
      and shift_date is null and date is null
      and effective_to is null
      and effective_from<p_effective_from;

    delete from public.shift_schedules
    where staff_id=p_staff_id
      and day_name=v_day
      and shift_date is null and date is null
      and effective_to is null
      and effective_from=p_effective_from;

    insert into public.shift_schedules(
      staff_id,staff_name,employee_name,role,branch,branch_id,day_name,
      shift_start,shift_end,hours,is_off,is_day_off,is_different,has_custom_time,
      notes,raw_shift,source,status,effective_from,effective_to
    )
    values(
      p_staff_id,
      coalesce(nullif(v_row->>'staff_name',''),v_staff.name),
      coalesce(nullif(v_row->>'employee_name',''),v_staff.name),
      coalesce(nullif(v_row->>'role',''),v_staff.role),
      coalesce(nullif(v_row->>'branch',''),v_staff.branch),
      nullif(v_row->>'branch_id','')::uuid,
      v_day,
      nullif(v_row->>'shift_start',''),
      nullif(v_row->>'shift_end',''),
      nullif(v_row->>'hours','')::numeric,
      coalesce((v_row->>'is_off')::boolean,false),
      coalesce((v_row->>'is_day_off')::boolean,coalesce((v_row->>'is_off')::boolean,false)),
      coalesce((v_row->>'is_different')::boolean,false),
      coalesce((v_row->>'has_custom_time')::boolean,false),
      coalesce(nullif(v_row->>'notes',''),p_note),
      nullif(v_row->>'raw_shift',''),
      coalesce(nullif(v_row->>'source',''),'versioned_schedule_rpc'),
      coalesce(nullif(v_row->>'status',''),'scheduled'),
      p_effective_from,
      null
    );
    v_count:=v_count+1;
  end loop;

  return jsonb_build_object(
    'success',true,'staff_id',p_staff_id,'staff_name',v_staff.name,
    'effective_from',p_effective_from,'rows_written',v_count
  );
end;
$$;

revoke all on function public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text) from public,anon;
grant execute on function public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text) to authenticated,service_role;

create or replace function public.dawaa_staff_scheduled_workday_v1(p_staff_id uuid,p_target_date date)
returns boolean
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $$
declare v_sched record; v_day_ar text; v_day_off text;
begin
  if p_staff_id is null or p_target_date is null then return false; end if;
  if exists(
    select 1 from public.staff_time_off_requests r
    where r.staff_id=p_staff_id and r.status='approved'
      and r.request_kind in('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and p_target_date between r.start_date and r.end_date
  ) then return false; end if;

  select * into v_sched from public.attendance_schedule_for_date_v1(p_staff_id,p_target_date);
  if found then return not(coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false)); end if;

  v_day_ar:=case extract(dow from p_target_date)::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;
  select nullif(trim(coalesce(s.day_off,'')),'') into v_day_off from public.staff s where s.id=p_staff_id;
  if v_day_off is not null and v_day_off=v_day_ar then return false; end if;
  return true;
end;
$$;

drop policy if exists shift_schedules_insert_app on public.shift_schedules;
drop policy if exists shift_schedules_update_app on public.shift_schedules;
drop policy if exists shift_schedules_select_app on public.shift_schedules;

create policy shift_schedules_select_authenticated_v2
on public.shift_schedules for select to authenticated
using (true);
