-- Search indexes for Customer Requests V2 operational inbox.
-- The UI uses contains-search across these text columns; trigram indexes keep search responsive as history grows.

create index if not exists idx_customer_requests_customer_name_trgm_v2
  on public.customer_requests using gin (customer_name gin_trgm_ops);

create index if not exists idx_customer_requests_medicine_name_trgm_v2
  on public.customer_requests using gin (medicine_name gin_trgm_ops);

create index if not exists idx_customer_requests_doctor_name_trgm_v2
  on public.customer_requests using gin (doctor_name gin_trgm_ops);

create index if not exists idx_customer_requests_source_assignee_trgm_v2
  on public.customer_requests using gin (source_assigned_employee gin_trgm_ops);

create index if not exists idx_customer_requests_customer_code_trgm_v2
  on public.customer_requests using gin (customer_code gin_trgm_ops);

create index if not exists idx_customer_requests_product_code_trgm_v2
  on public.customer_requests using gin (product_code gin_trgm_ops);
