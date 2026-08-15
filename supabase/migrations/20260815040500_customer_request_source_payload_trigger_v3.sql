-- Ensure Base44 source payload enrichment runs whenever the raw source snapshot changes.
-- This preserves exact request time (requested_at, falling back to created_date), quantity,
-- request type and registrar while keeping local workflow status forward-only.

drop trigger if exists trg_customer_request_autolink_dawaawael_v1 on public.customer_requests;
create trigger trg_customer_request_autolink_dawaawael_v1
before insert or update of source_system, source_payload, customer_id, customer_code, customer_phone, branch, primary_responsible_id
on public.customer_requests
for each row execute function public.customer_request_autolink_dawaawael_v1();

-- Re-run enrichment for the complete linked Base44 population so historical rows get the
-- same exact-time/type/registrar normalization as new rows.
update public.customer_requests
set source_payload = source_payload
where source_system='dawaawael'
  and source_entity='CustomerOrder';
