-- Guard refusal case for 20261016090100: a different attendance_policy_v3_cutover_readiness_v1 already exists.
-- The migration must refuse to replace it.
create or replace function public.attendance_policy_v3_cutover_readiness_v1(p_start date default null, p_end date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $function$
begin
  return jsonb_build_object('schema','attendance_policy_v3_cutover_readiness_v1','ready_for_v3_cutover',true);
end;
$function$;
