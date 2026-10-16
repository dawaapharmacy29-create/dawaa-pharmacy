-- The fingerprint changed after review: the migration must refuse and install nothing.
CREATE OR REPLACE FUNCTION public.attendance_resolution_fingerprint_v2(p_resolution_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select md5(jsonb_build_object('id',a.id,'status',a.status)::text)
  from public.attendance_daily_summary a where a.id=p_resolution_id
$function$;
