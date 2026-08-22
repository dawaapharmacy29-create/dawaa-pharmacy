-- Return only the pending shift-notes count instead of downloading up to 500 rows
-- to every mounted client just to calculate a sidebar/header badge.

create or replace function public.count_pending_shift_notes_v1()
returns bigint
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
  select count(*)::bigint
  from public.shift_notes
  where deleted_at is null
    and completed_at is null
    and (
      status is null
      or btrim(status) = ''
      or status !~* '(completed|done|closed|cancelled|deleted|تم|مغلق|ملغي|محذوف)'
    );
$function$;

grant execute on function public.count_pending_shift_notes_v1() to anon, authenticated;
