-- The invalidation trigger changed after review: the migration must refuse and install nothing.
create or replace function public.hr_invalidate_overtime_on_attendance_change_v1()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return new;
end;
$function$;
