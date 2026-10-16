-- Guard refusal case for 20261015140200: hr_canonical_architecture_health_v1 loses its session-actor check.
-- The migration must refuse the anon grant.
create or replace function public.hr_canonical_architecture_health_v1()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return jsonb_build_object('schema','hr_canonical_architecture_health_v1','status','healthy');
end;
$function$;
