-- Guard refusal case for 20261016100000: Production's payroll_cycle_finalization_overview_v2 changed after review.
-- The migration must refuse and create nothing.
create or replace function public.payroll_cycle_finalization_overview_v2(p_month_cycle text, p_branch text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return jsonb_build_object('schema','payroll_cycle_finalization_overview_v2','changed_after_review',true);
end;
$function$;
