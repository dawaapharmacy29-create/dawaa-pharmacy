-- Safe request-scoped read boundary for Customer Request point events.
create or replace function public.get_customer_request_incentive_events(p_request_id uuid)
returns table (
  id uuid,
  request_id uuid,
  event_key text,
  staff_id uuid,
  tier_key text,
  points numeric,
  policy_version text,
  event_at timestamptz,
  employee_transaction_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.request_id,
    e.event_key,
    e.staff_id,
    e.tier_key,
    e.points,
    e.policy_version,
    e.event_at,
    e.employee_transaction_id
  from public.customer_request_incentive_events e
  where e.request_id = p_request_id
  order by e.event_at asc;
$$;

revoke all on function public.get_customer_request_incentive_events(uuid) from public;
grant execute on function public.get_customer_request_incentive_events(uuid) to anon, authenticated, service_role;
