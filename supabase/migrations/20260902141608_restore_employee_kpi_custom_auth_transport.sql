-- Custom app authentication uses the anon PostgREST transport role, while
-- dawaa_can_read_staff_kpi() resolves the current staff actor and enforces
-- the application permission + branch boundary. Grant transport access only;
-- an unidentified actor still receives zero rows.
grant execute on function public.dawaa_can_read_staff_kpi(uuid, text)
to anon, authenticated, service_role;

grant select on public.employee_kpi_30d_summary
to anon, authenticated, service_role;
