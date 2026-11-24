-- Owner request 2026-11-24: an invoice-matched delivery order is final; a missing shift in the delivery app must not
-- hold it when the rider has a fingerprint that day. Every 15 minutes the fingerprint days of the open and previous
-- cycle for every mapped rider go to the delivery app (ingest_rider_fingerprint_days_v1, same bridge key as the
-- invoice export), which releases those orders. See supabase/sql/delivery-os/20261124120000_fingerprint_verified_orders_v1.sql.
-- Also maps محمود القطري and محمد حجازي to their riders (exact name, same branch), which were missing.

insert into public.delivery_payroll_identity_map_v1 (staff_id, delivery_project_ref, rider_id, rider_name_snapshot, rider_branch_snapshot, mapping_status, active, confidence, source, effective_from)
select v.staff_id::uuid, 'qlugjplnnkjzxcbhwopg', v.rider_id::uuid, v.rider_name, v.branch, 'approved', true, 'high', 'exact_name_verified', date '2026-10-26'
from (values ('3b35a78f-edf5-4b0c-b96c-be715a256bac', '21f708af-be42-45bf-b29d-14d4f18acd8e', 'محمود القطري', 'فرع الشامي'),
             ('f80d9f10-2296-4eda-b9c8-e70f1ce135cd', '4528ce8e-224a-4b1e-8f35-695235190b0a', 'محمد حجازي', 'فرع شكري')) v(staff_id, rider_id, rider_name, branch)
where not exists (select 1 from public.delivery_payroll_identity_map_v1 m where m.staff_id::text = v.staff_id and coalesce(m.active, true));

create or replace function public.push_rider_fingerprint_days_v1()
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare v_config jsonb; v_rows jsonb; v_request bigint;
begin
  v_config := public.delivery_invoice_bridge_config_v1();
  if v_config->>'delivery_invoice_bridge_key' is null or v_config->>'delivery_invoice_publishable_key' is null then
    raise exception 'delivery_bridge_not_configured';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('rider_id', m.rider_id, 'work_day', a.attendance_date,
           'first_in', a.first_in, 'last_out', a.last_out)), '[]'::jsonb)
    into v_rows
  from public.delivery_payroll_identity_map_v1 m
  join public.attendance_daily_summary a on a.staff_id::text = m.staff_id::text
  where coalesce(m.active, true) and m.mapping_status = 'approved' and m.rider_id is not null
    and a.first_in is not null
    and a.attendance_date >= ((now() at time zone 'Africa/Cairo')::date - 62);
  select net.http_post(url := 'https://qlugjplnnkjzxcbhwopg.supabase.co/rest/v1/rpc/ingest_rider_fingerprint_days_v1',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_config->>'delivery_invoice_publishable_key'),
    body := jsonb_build_object('p_key', v_config->>'delivery_invoice_bridge_key', 'p_rows', v_rows),
    timeout_milliseconds := 60000) into v_request;
  return v_request;
end;
$function$;
revoke all on function public.push_rider_fingerprint_days_v1() from public, anon, authenticated;

select cron.schedule('push-rider-fingerprint-days-15min', '4-59/15 * * * *', 'select public.push_rider_fingerprint_days_v1();');
select public.push_rider_fingerprint_days_v1();
