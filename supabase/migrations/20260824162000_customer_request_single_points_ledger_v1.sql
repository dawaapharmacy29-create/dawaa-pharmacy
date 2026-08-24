-- Retire legacy Customer Request point writers.
-- The only active point source for Customer Requests is now:
-- customer_request_incentive_events -> employee_transactions(source='customer_request_incentive').
-- Legacy columns remain for backward-compatible reads, but no trigger may calculate them.

drop trigger if exists request_self_log_settlement on public.customer_requests;
drop trigger if exists trg_set_customer_request_points_tier on public.customer_requests;

comment on function public.settle_doctor_self_logged_request(uuid) is
  'LEGACY / RETIRED: no active trigger calls this function. Customer Request points settle only through settle_customer_request_doctor_points.';

comment on function public.set_customer_request_points_tier() is
  'LEGACY / RETIRED: points_tier/points_awarded are not an authoritative ledger. Customer Request points live in employee_transactions via customer_request_incentive_events.';
