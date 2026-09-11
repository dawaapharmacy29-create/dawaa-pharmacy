alter table public.staff add column if not exists task_profile text;

comment on column public.staff.task_profile is 'Optional daily operating task profile override. Does not change permissions/account role.';

update public.staff
set task_profile = 'pharmacist', updated_at = now()
where trim(name) = 'د دنيا'
  and branch = 'فرع شكري'
  and coalesce(is_active,true) = true;

create or replace function public.resolve_operational_task_role_v1(
  p_staff_id text,
  p_staff_role text,
  p_account_role text
)
returns text
language sql
stable
set search_path = public, pg_catalog
as $function$
  select coalesce(
    nullif(lower(trim(s.task_profile)),''),
    public.resolve_operational_staff_role_v1(p_staff_role, p_account_role)
  )
  from (select 1) x
  left join public.staff s on s.id::text = p_staff_id;
$function$;

create or replace function public.ensure_daily_operating_tasks_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_staff record;
  v_before_employee integer := 0;
  v_after_employee integer := 0;
  v_before_branch integer := 0;
  v_after_branch integer := 0;
begin
  select count(*) into v_before_employee
  from public.employee_daily_tasks
  where task_date = v_day;

  for v_staff in
    select
      s.id::text as staff_id,
      s.name as staff_name,
      public.resolve_operational_task_role_v1(s.id::text, s.role, sa.role) as role,
      s.branch
    from public.staff s
    left join public.staff_accounts sa
      on sa.staff_id = s.id::text
     and sa.active = true
     and sa.can_login = true
    where coalesce(s.is_active, true) = true
      and coalesce(s.active, true) = true
      and not exists (
        select 1
        from public.employee_daily_tasks edt
        where edt.staff_id = s.id::text
          and edt.task_date = v_day
      )
  loop
    perform public.generate_employee_daily_tasks(
      v_staff.staff_id,
      v_staff.staff_name,
      v_staff.role,
      v_staff.branch,
      v_day
    );
  end loop;

  select count(*) into v_after_employee
  from public.employee_daily_tasks
  where task_date = v_day;

  select count(*) into v_before_branch
  from public.branch_daily_tasks
  where task_date = v_day
    and branch in ('فرع الشامي','فرع شكري');

  perform * from public.create_daily_branch_tasks('فرع الشامي', v_day, null);
  perform * from public.create_daily_branch_tasks('فرع شكري', v_day, null);

  select count(*) into v_after_branch
  from public.branch_daily_tasks
  where task_date = v_day
    and branch in ('فرع الشامي','فرع شكري');

  return jsonb_build_object(
    'taskDate', v_day,
    'employeeTasksCreated', greatest(v_after_employee - v_before_employee, 0),
    'employeeTasksTotal', v_after_employee,
    'branchTasksCreated', greatest(v_after_branch - v_before_branch, 0),
    'branchTasksTotal', v_after_branch
  );
end;
$function$;

delete from public.employee_daily_tasks edt
using public.staff s
where edt.staff_id = s.id::text
  and trim(s.name) = 'د دنيا'
  and s.branch = 'فرع شكري'
  and edt.task_date = (now() at time zone 'Africa/Cairo')::date
  and edt.status = 'pending'
  and edt.source = 'role_profile'
  and edt.task_key like 'assistant.%';

select public.generate_employee_daily_tasks(
  s.id::text,
  s.name,
  'pharmacist',
  s.branch,
  (now() at time zone 'Africa/Cairo')::date
)
from public.staff s
where trim(s.name) = 'د دنيا'
  and s.branch = 'فرع شكري'
  and coalesce(s.is_active,true) = true;
