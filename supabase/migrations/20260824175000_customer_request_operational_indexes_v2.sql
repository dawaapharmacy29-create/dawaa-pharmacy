-- Operational indexes aligned with the V2 inbox filters and deep links.

create index if not exists idx_customer_requests_requested_at_v2
  on public.customer_requests (requested_at desc);

create index if not exists idx_customer_requests_branch_requested_at_v2
  on public.customer_requests (branch, requested_at desc);

create index if not exists idx_customer_requests_doctor_id_requested_at_v2
  on public.customer_requests (doctor_id, requested_at desc)
  where doctor_id is not null;

create index if not exists idx_customer_requests_status_requested_at_v2
  on public.customer_requests (status, requested_at desc);
