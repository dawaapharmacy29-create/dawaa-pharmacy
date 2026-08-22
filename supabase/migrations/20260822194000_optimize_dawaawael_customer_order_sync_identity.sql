create index if not exists idx_customers_sync_customer_code_v1
on public.customers ((trim(coalesce(customer_code::text,''))), updated_at desc)
include (id)
where trim(coalesce(customer_code::text,'')) <> '';

create index if not exists idx_customers_sync_effective_code_v1
on public.customers ((trim(coalesce(effective_customer_code::text,''))), updated_at desc)
include (id)
where trim(coalesce(effective_customer_code::text,'')) <> '';

create index if not exists idx_customers_sync_norm_phone_v1
on public.customers ((public.dawaa_sync_norm_phone(coalesce(customer_phone, phone, mobile, whatsapp_phone, whatsapp))))
include (id)
where public.dawaa_sync_norm_phone(coalesce(customer_phone, phone, mobile, whatsapp_phone, whatsapp)) is not null;

create index if not exists idx_customer_requests_sync_code_key_v1
on public.customer_requests (
  (coalesce(branch,'')),
  (public.dawaa_sync_norm_text(medicine_name)),
  (trim(coalesce(customer_code,''))),
  created_at
)
include (requested_at)
where trim(coalesce(customer_code,'')) <> '';

create index if not exists idx_customer_requests_sync_phone_key_v1
on public.customer_requests (
  (coalesce(branch,'')),
  (public.dawaa_sync_norm_text(medicine_name)),
  (public.dawaa_sync_norm_phone(customer_phone)),
  created_at
)
include (requested_at)
where public.dawaa_sync_norm_phone(customer_phone) is not null;
