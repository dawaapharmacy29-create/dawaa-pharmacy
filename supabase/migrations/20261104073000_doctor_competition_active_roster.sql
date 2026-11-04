-- Use active staff as the competition roster. Login eligibility is independent.
create or replace function public.get_eligible_doctor_accounts()
returns table(staff_id text, name text, branch text)
language sql stable security definer
set search_path to 'public'
as $function$
  select s.id::text, btrim(s.name), btrim(s.branch)
  from public.staff s
  where s.active is true
    and nullif(btrim(s.name), '') is not null
    and nullif(btrim(s.branch), '') is not null
    and (
      s.role in ('pharmacist', 'صيدلاني', 'صيدلي')
      or exists (
        select 1 from public.staff_accounts sa
        where sa.staff_id = s.id::text and coalesce(sa.active, true)
          and (
            sa.role in ('pharmacist', 'shift_supervisor', 'shift_supervisor_morning', 'shift_supervisor_evening', 'branch_manager')
            or (sa.role = 'branches_manager' and btrim(s.name) = 'د/ علا')
            or (sa.role = 'executive_manager' and btrim(s.name) = 'د وائل')
          )
      )
    );
$function$;

create or replace function public.get_eligible_doctor_staff_ids()
returns table(staff_id text)
language sql stable security invoker
set search_path to 'public'
as $function$
  select staff_id from public.get_eligible_doctor_accounts();
$function$;
