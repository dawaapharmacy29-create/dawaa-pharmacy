-- Replay prerequisite for Points Architecture V3.
-- These identity/cycle helpers must exist before the 14:10 cleaning migration.
-- Definitions intentionally match current production semantics and are idempotent.

create or replace function public.employee_operating_actor_id()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    nullif((nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id'), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$function$;

create or replace function public.employee_operating_actor_role()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select lower(trim(coalesce(sa.role, '')))
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$function$;

create or replace function public.employee_operating_actor_branch()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select nullif(trim(coalesce(sa.branch, '')), '')
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$function$;

create or replace function public.dawaa_current_staff_id_v1()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sa.staff_id::text
  from public.staff_accounts sa
  where sa.id::text = coalesce(
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', ''),
    nullif(auth.uid()::text, '')
  )
  limit 1;
$function$;

create or replace function public.dawaa_current_points_cycle_label_v1()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when extract(day from (now() at time zone 'Africa/Cairo')) >= 26
      then to_char(((now() at time zone 'Africa/Cairo')::date + interval '1 month')::date, 'YYYY-MM')
    else to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM')
  end
$function$;

revoke all on function public.employee_operating_actor_id() from public;
revoke all on function public.employee_operating_actor_role() from public;
revoke all on function public.employee_operating_actor_branch() from public;
revoke all on function public.dawaa_current_staff_id_v1() from public;
revoke all on function public.dawaa_current_points_cycle_label_v1() from public;

grant execute on function public.employee_operating_actor_id() to anon, authenticated, service_role;
grant execute on function public.employee_operating_actor_role() to anon, authenticated, service_role;
grant execute on function public.employee_operating_actor_branch() to anon, authenticated, service_role;
grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated, service_role;
grant execute on function public.dawaa_current_points_cycle_label_v1() to service_role;
