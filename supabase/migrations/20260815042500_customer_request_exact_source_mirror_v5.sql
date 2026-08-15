-- Keep source_* metadata as an exact mirror of the latest Base44 CustomerOrder payload.
-- Local operational fields (status, purchasing_assignee, notes, etc.) remain independent.

create or replace function public.customer_request_exact_source_mirror_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.source_system,'') <> 'dawaawael'
     or coalesce(new.source_entity,'') <> 'CustomerOrder'
     or new.source_payload is null then
    return new;
  end if;

  new.source_order_number := nullif(btrim(new.source_payload->>'order_number'),'');
  new.source_status := nullif(btrim(new.source_payload->>'status'),'');
  new.source_request_channel := nullif(btrim(new.source_payload->>'request_source'),'');
  new.source_assigned_employee := nullif(btrim(new.source_payload->>'assigned_employee'),'');
  new.source_notes := nullif(btrim(new.source_payload->>'notes'),'');

  begin
    new.source_updated_at := nullif(new.source_payload->>'updated_date','')::timestamptz;
  exception when others then
    null;
  end;

  begin
    new.source_selling_price := nullif(new.source_payload->>'selling_price','')::numeric;
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke all on function public.customer_request_exact_source_mirror_v1() from public;

drop trigger if exists zz_customer_request_exact_source_mirror_v1 on public.customer_requests;
create trigger zz_customer_request_exact_source_mirror_v1
before insert or update of source_system, source_entity, source_payload
on public.customer_requests
for each row execute function public.customer_request_exact_source_mirror_v1();

-- Backfill every current Base44-linked row using the preserved raw payload.
update public.customer_requests
set source_payload = source_payload
where source_system='dawaawael'
  and source_entity='CustomerOrder';
