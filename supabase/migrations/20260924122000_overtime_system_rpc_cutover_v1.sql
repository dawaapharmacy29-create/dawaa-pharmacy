-- Overtime system RPC cutover v1
-- Legacy V1 system functions remain for compatibility but delegate to V2.
-- Detector/sync RPCs are background-only and must not be callable by app roles.

create or replace function public.dawaa_detect_pending_overtime_v1(
  p_lookback_days integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  return public.dawaa_detect_pending_overtime_v2(p_lookback_days);
end;
$$;

create or replace function public.dawaa_sync_attendance_overtime_reward_v1(
  p_month_cycle text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  return public.dawaa_sync_attendance_overtime_reward_v2(p_month_cycle);
end;
$$;

revoke execute on function public.dawaa_detect_pending_overtime_v1(integer)
  from public,anon,authenticated;
revoke execute on function public.dawaa_sync_attendance_overtime_reward_v1(text)
  from public,anon,authenticated;
revoke execute on function public.dawaa_detect_pending_overtime_v2(integer)
  from public,anon,authenticated;
revoke execute on function public.dawaa_sync_attendance_overtime_reward_v2(text)
  from public,anon,authenticated;

grant execute on function public.dawaa_detect_pending_overtime_v1(integer) to service_role;
grant execute on function public.dawaa_sync_attendance_overtime_reward_v1(text) to service_role;
grant execute on function public.dawaa_detect_pending_overtime_v2(integer) to service_role;
grant execute on function public.dawaa_sync_attendance_overtime_reward_v2(text) to service_role;
