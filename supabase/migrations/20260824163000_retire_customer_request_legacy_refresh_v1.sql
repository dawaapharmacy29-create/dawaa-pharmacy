-- Fully retire legacy Customer Request point settlement entry points.
-- The approved source of truth is the versioned event ledger:
-- customer_request_incentive_events -> employee_transactions(source='customer_request_incentive').

revoke all on function public.settle_doctor_self_logged_request(uuid) from public, anon, authenticated;
grant execute on function public.settle_doctor_self_logged_request(uuid) to service_role;

create or replace function public.refresh_doctor_customer_request_points(
  p_month_cycle text default to_char(current_date, 'YYYY-MM')
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- RETIRED: deliberately no-op.
  -- Never rebuild Customer Request points from legacy points_tier/points_awarded columns.
  -- Versioned request_registered/request_achieved events are settled incrementally instead.
  return 0;
end;
$$;

revoke all on function public.refresh_doctor_customer_request_points(text) from public, anon, authenticated;
grant execute on function public.refresh_doctor_customer_request_points(text) to service_role;

comment on function public.refresh_doctor_customer_request_points(text) is
  'LEGACY / RETIRED NO-OP. Customer Request points are settled incrementally via customer_request_incentive_events.';
