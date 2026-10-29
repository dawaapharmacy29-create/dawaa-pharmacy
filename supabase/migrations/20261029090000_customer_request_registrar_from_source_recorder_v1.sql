-- Customer request registrar: read the canonical recording employee.
--
-- Requests synced from DawaaWael carry the recording employee in source_recorded_staff_id
-- (278/278 in cycle 2026-09-26 → 2026-10-25) and never fill doctor_id or a uuid created_by, so
-- resolve_customer_request_registrar_staff_id returned null for every synced request and no
-- request was ever credited (0 customer_request_incentive transactions out of 1,259 requests).
--
-- This keeps doctor_id and created_by first (manual requests) and adds source_recorded_staff_id.
-- It does NOT change the eligibility rules of settle_customer_request_doctor_points: that function
-- still requires customer_id, customer_code, medicine_name and product_code, and no synced request
-- has a product_code, so applying this alone credits no points. Crediting starts only after the
-- owner decides the product_code rule (separate, approved change).
-- Verified by scripts/verification/test-customer-request-registrar-native.mjs.
--
-- Rollback: recreate the function without the source_recorded_staff_id branch.

begin;

create or replace function public.resolve_customer_request_registrar_staff_id(p_request customer_requests)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_staff_id uuid;
  v_created_uuid uuid;
  v_recorded_uuid uuid;
begin
  if p_request.doctor_id is not null and exists(select 1 from public.staff s where s.id = p_request.doctor_id) then
    return p_request.doctor_id;
  end if;
  begin
    v_created_uuid := nullif(trim(coalesce(p_request.created_by, '')), '')::uuid;
  exception when others then
    v_created_uuid := null;
  end;
  if v_created_uuid is not null then
    select s.id into v_staff_id from public.staff s where s.id = v_created_uuid limit 1;
    if v_staff_id is not null then return v_staff_id; end if;
    select sa.staff_id into v_staff_id from public.staff_accounts sa where sa.id = v_created_uuid and sa.staff_id is not null limit 1;
    if v_staff_id is not null then return v_staff_id; end if;
  end if;
  -- Synced requests: the recording employee resolved by the sync to a staff id.
  begin
    v_recorded_uuid := nullif(trim(coalesce(p_request.source_recorded_staff_id::text, '')), '')::uuid;
  exception when others then
    v_recorded_uuid := null;
  end;
  if v_recorded_uuid is not null then
    select s.id into v_staff_id from public.staff s where s.id = v_recorded_uuid limit 1;
    if v_staff_id is not null then return v_staff_id; end if;
  end if;
  return null;
end
$function$;

commit;
