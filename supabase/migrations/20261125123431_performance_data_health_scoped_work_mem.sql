SET LOCAL lock_timeout = '2s';
ALTER FUNCTION public.compute_app_data_health_v2() SET work_mem TO '8MB';
