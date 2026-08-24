-- Retry registration settlement when a request becomes canonically linkable after creation.
-- This is required because legacy/base44 flows may link customer/product/registrar after the initial insert.

create or replace function public.customer_request_doctor_points_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registered_at timestamptz;
  v_old_fulfilled boolean;
  v_new_fulfilled boolean;
begin
  v_registered_at := coalesce(new.requested_at,new.created_at,now());

  if tg_op = 'INSERT' then
    perform public.settle_customer_request_doctor_points(new.id,'request_registered',v_registered_at);
    if new.status in ('available','arrived','customer_contacted','delivered','closed') then
      perform public.settle_customer_request_doctor_points(new.id,'request_achieved',coalesce(new.updated_at,now()));
    end if;
    return new;
  end if;

  -- Idempotent retry: once customer/product/doctor identity is repaired, registration credit can settle.
  perform public.settle_customer_request_doctor_points(new.id,'request_registered',v_registered_at);

  v_old_fulfilled := old.status in ('available','arrived','customer_contacted','delivered','closed');
  v_new_fulfilled := new.status in ('available','arrived','customer_contacted','delivered','closed');
  if not v_old_fulfilled and v_new_fulfilled then
    perform public.settle_customer_request_doctor_points(new.id,'request_achieved',coalesce(new.updated_at,now()));
  elsif v_new_fulfilled then
    -- Also retry achieved credit if identity was repaired after the fulfillment transition.
    perform public.settle_customer_request_doctor_points(new.id,'request_achieved',coalesce(new.updated_at,now()));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_request_doctor_points on public.customer_requests;
create trigger trg_customer_request_doctor_points
after insert or update of status, customer_id, customer_code, product_id, product_code, doctor_id, sync_conflict
on public.customer_requests
for each row execute function public.customer_request_doctor_points_trigger();
