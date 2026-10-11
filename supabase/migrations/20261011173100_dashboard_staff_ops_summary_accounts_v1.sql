-- Remove the dashboard RPC dependency on the retired permissions audit relation.
-- Keep the account-state predicates and response contract unchanged.

create or replace function public.get_dashboard_staff_ops_summary_v171()
returns table (
  active_accounts bigint,
  disabled_accounts bigint,
  pending_time_off bigint,
  absences_today bigint,
  late_today bigint
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    (select count(*)::bigint
     from public.staff_accounts
     where active = true
       and coalesce(can_login, true) = true),
    (select count(*)::bigint
     from public.staff_accounts
     where active = false
        or coalesce(can_login, true) = false),
    0::bigint,
    0::bigint,
    0::bigint
$function$;

revoke all on function public.get_dashboard_staff_ops_summary_v171() from public;
grant execute on function public.get_dashboard_staff_ops_summary_v171()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
