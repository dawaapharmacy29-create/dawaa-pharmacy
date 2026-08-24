-- Align Customer Request point transactions to the application's canonical 26 -> 25
-- cycle label convention: the cycle is named by the month in which it ends.
-- Example: 26 Jul -> 25 Aug is `2026-08`; 26 Aug -> 25 Sep is `2026-09`.

create or replace function public.customer_request_cycle_label(p_event_at timestamptz)
returns text
language sql
immutable
as $$
  select case
    when extract(day from (p_event_at at time zone 'Africa/Cairo')) >= 26
      then to_char(((p_event_at at time zone 'Africa/Cairo')::date + interval '1 month')::date, 'YYYY-MM')
    else to_char((p_event_at at time zone 'Africa/Cairo')::date, 'YYYY-MM')
  end
$$;

-- No Customer Request incentive events existed when this correction was deployed,
-- but keep the reconciliation idempotent for environments where the earlier branch
-- migration may already have generated events.
update public.customer_request_incentive_events e
set metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
  'month_cycle', public.customer_request_cycle_label(e.event_at),
  'cycle_label_convention', 'end_month'
)
where coalesce(e.metadata ->> 'month_cycle', '') is distinct from public.customer_request_cycle_label(e.event_at);

update public.employee_transactions et
set month_cycle = public.customer_request_cycle_label(e.event_at)
from public.customer_request_incentive_events e
where et.id = e.employee_transaction_id
  and et.source = 'customer_request_incentive'
  and et.month_cycle is distinct from public.customer_request_cycle_label(e.event_at);
