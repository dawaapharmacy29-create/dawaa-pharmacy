create or replace function public.guard_admin_employee_daily_tasks_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(new.role,'')));
begin
  -- Delivery riders are operated from the dedicated delivery application.
  -- They must not create operational tasks or notification noise in the admin app.
  if v_role in ('rider','delivery','توصيل','مندوب توصيل')
     or coalesce(new.task_key,'') like 'rider.%' then
    return null;
  end if;

  -- Pharmacy-side preparation can stay as an admin task, but must never navigate
  -- to the separate delivery application route.
  if coalesce(new.related_route,'') = '/delivery' then
    new.related_route := '/my-daily-checklist';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_admin_employee_daily_tasks_v1 on public.employee_daily_tasks;
create trigger trg_guard_admin_employee_daily_tasks_v1
before insert or update on public.employee_daily_tasks
for each row
execute function public.guard_admin_employee_daily_tasks_v1();

delete from public.notifications n
where (
  coalesce(n.metadata->>'source','') = 'employee_daily_tasks'
  and (
    coalesce(n.metadata->>'route','') = '/delivery'
    or coalesce(n.action_url,n.target_route,n.route,n.link,'') = '/delivery'
  )
)
or exists (
  select 1
  from public.employee_daily_tasks t
  where t.id::text = coalesce(n.entity_id,n.related_id,'')
    and (
      lower(trim(coalesce(t.role,''))) in ('rider','delivery','توصيل','مندوب توصيل')
      or coalesce(t.task_key,'') like 'rider.%'
    )
);

delete from public.employee_daily_tasks
where completed_at is null
  and (
    lower(trim(coalesce(role,''))) in ('rider','delivery','توصيل','مندوب توصيل')
    or coalesce(task_key,'') like 'rider.%'
  );

update public.employee_daily_tasks
set related_route = '/my-daily-checklist'
where completed_at is null
  and coalesce(related_route,'') = '/delivery'
  and not (
    lower(trim(coalesce(role,''))) in ('rider','delivery','توصيل','مندوب توصيل')
    or coalesce(task_key,'') like 'rider.%'
  );