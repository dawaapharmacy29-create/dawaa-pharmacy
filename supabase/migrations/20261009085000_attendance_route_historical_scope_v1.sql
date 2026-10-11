-- Attendance policy routing must survive staff deactivation.
-- Historical/current-cycle attendance can still require review or payroll after a staff member becomes inactive.
-- Operational workers may continue to ignore inactive staff through their own existing guards.

create or replace function public.dawaa_attendance_engine_route_v1(p_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_flexible boolean;
  v_active boolean;
  v_branch text;
begin
  if p_staff_id is null then
    raise exception 'attendance_route_staff_id_required' using errcode='22023';
  end if;

  select coalesce(s.active,false),s.branch
    into v_active,v_branch
  from public.staff s
  where s.id=p_staff_id
  limit 1;

  if not found or v_branch not in ('فرع الشامي','فرع شكري') then
    return jsonb_build_object(
      'staff_id',p_staff_id,
      'in_scope',false,
      'operational_active',coalesce(v_active,false),
      'branch',v_branch,
      'route','out_of_scope',
      'resolution_version',null,
      'flexible',null
    );
  end if;

  v_flexible:=public.dawaa_staff_flexible_attendance_v1(p_staff_id);

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'in_scope',true,
    'operational_active',v_active,
    'branch',v_branch,
    'route',case when v_flexible then 'flexible_v3' else 'standard_v2' end,
    'resolution_version',case when v_flexible then 3 else 2 end,
    'flexible',v_flexible
  );
end;
$function$;

revoke all on function public.dawaa_attendance_engine_route_v1(uuid) from public,anon,authenticated;
grant execute on function public.dawaa_attendance_engine_route_v1(uuid) to service_role;
