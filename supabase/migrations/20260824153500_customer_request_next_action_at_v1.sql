-- Preserve exact customer-request follow-up time without changing the legacy due_date DATE contract.
-- New V2 writes use next_action_at; legacy readers can continue using due_date during rollout.

alter table public.customer_requests
  add column if not exists next_action_at timestamptz;

comment on column public.customer_requests.next_action_at is
  'Exact timestamp for the next operational customer-request action/follow-up. due_date remains a legacy date-only fallback.';

create index if not exists idx_customer_requests_next_action_at_open
  on public.customer_requests (next_action_at)
  where next_action_at is not null
    and coalesce(status, 'new') not in ('closed', 'delivered', 'cancelled');
