create or replace function public.dawaa_invalidate_customer_sales_caches_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  -- These tables are disposable caches. Clearing them here is intentional,
  -- but the database safe-delete guard requires an explicit WHERE clause.
  delete from public.customer_service_analytics_cache_v1 where true;
  delete from public.customer_service_top50_cache where true;
  delete from public.dawaa_customer_intelligence_cache_v1 where true;

  update public.app_refresh_flags
     set is_pending = true,
         last_triggered_at = now(),
         updated_at = now()
   where flag_key = 'monthly_performance';

  return null;
end;
$function$;
