create or replace function public.integration_sync_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor_id uuid;
  v_now timestamptz := now();
  v_customer jsonb;
  v_purchase jsonb;
  v_biometric jsonb;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not exists (
    select 1 from public.staff_accounts sa
    where sa.id=v_actor_id and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true
  ) then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  select jsonb_build_object(
    'stream','customer_orders',
    'source_system','dawaawael',
    'source_entity','CustomerOrder',
    'total_canonical',count(*)::int,
    'last_source_updated_at',max(source_updated_at),
    'last_seen_at',max(source_last_seen_at),
    'heartbeat_age_seconds',case when max(source_last_seen_at) is null then null else extract(epoch from (v_now-max(source_last_seen_at)))::int end,
    'status',case
      when max(source_last_seen_at) is null then 'unknown'
      when v_now-max(source_last_seen_at) <= interval '7 minutes' then 'healthy'
      when v_now-max(source_last_seen_at) <= interval '20 minutes' then 'delayed'
      else 'offline' end,
    'inbox_pending',(select count(*)::int from public.customer_request_sync_inbox where source_system='dawaawael' and source_entity='CustomerOrder' and processing_status in ('received','pending','processing')),
    'inbox_failed',(select count(*)::int from public.customer_request_sync_inbox where source_system='dawaawael' and source_entity='CustomerOrder' and processing_status in ('conflict','rejected','failed')),
    'inbox_last_received',(select max(received_at) from public.customer_request_sync_inbox where source_system='dawaawael' and source_entity='CustomerOrder'),
    'inbox_last_processed',(select max(processed_at) from public.customer_request_sync_inbox where source_system='dawaawael' and source_entity='CustomerOrder')
  ) into v_customer
  from public.customer_requests
  where source_system='dawaawael' and source_entity='CustomerOrder';

  select jsonb_build_object(
    'stream','purchase_invoices',
    'source_system','base44',
    'source_entity','PurchaseInvoice',
    'total_synced',count(*)::int,
    'last_record_synced_at',max(synced_at),
    'last_reconcile_at',(select max(ran_at) from public.base44_sync_run_log),
    'heartbeat_age_seconds',case when (select max(ran_at) from public.base44_sync_run_log) is null then null else extract(epoch from (v_now-(select max(ran_at) from public.base44_sync_run_log)))::int end,
    'status',case
      when (select max(ran_at) from public.base44_sync_run_log) is null then 'unknown'
      when v_now-(select max(ran_at) from public.base44_sync_run_log) <= interval '20 minutes' then 'healthy'
      when v_now-(select max(ran_at) from public.base44_sync_run_log) <= interval '45 minutes' then 'delayed'
      else 'offline' end,
    'matched',count(*) filter(where match_status='matched')::int,
    'ambiguous',count(*) filter(where match_status='ambiguous')::int,
    'unmatched',count(*) filter(where match_status='unmatched')::int,
    'last_run_status',(select status from public.base44_sync_run_log order by ran_at desc limit 1),
    'last_run_error',(select error_message from public.base44_sync_run_log order by ran_at desc limit 1)
  ) into v_purchase
  from public.base44_purchase_invoice_sync;

  select jsonb_build_object(
    'stream','biometrics',
    'source_system','fingerprint_vendor_primary',
    'total_raw',count(*)::int,
    'mapped',count(*) filter(where staff_id is not null)::int,
    'unmapped',count(*) filter(where staff_id is null)::int,
    'mapping_rate',case when count(*)>0 then round((count(*) filter(where staff_id is not null)::numeric/count(*)::numeric)*100,1) else 0 end,
    'last_punch_time',max(punch_time),
    'last_ingested_at',max(ingested_at),
    'last_client_seen_at',(select max(last_seen_at) from public.biometric_api_clients where active=true),
    'complete_through',(select max(complete_through) from public.biometric_sync_watermarks where provider='fingerprint_vendor_primary'),
    'heartbeat_age_seconds',case when (select max(last_seen_at) from public.biometric_api_clients where active=true) is null then null else extract(epoch from (v_now-(select max(last_seen_at) from public.biometric_api_clients where active=true)))::int end,
    'status',case
      when (select max(last_seen_at) from public.biometric_api_clients where active=true) is null then 'unknown'
      when v_now-(select max(last_seen_at) from public.biometric_api_clients where active=true) <= interval '5 minutes' then 'healthy'
      when v_now-(select max(last_seen_at) from public.biometric_api_clients where active=true) <= interval '15 minutes' then 'delayed'
      else 'offline' end
  ) into v_biometric
  from public.biometric_attendance_logs;

  return jsonb_build_object(
    'generated_at',v_now,
    'overall_status',case
      when (v_customer->>'status')='offline' or (v_purchase->>'status')='offline' or (v_biometric->>'status')='offline' then 'attention'
      when (v_customer->>'status')='delayed' or (v_purchase->>'status')='delayed' or (v_biometric->>'status')='delayed' then 'delayed'
      else 'healthy' end,
    'streams',jsonb_build_array(v_customer,v_purchase,v_biometric)
  );
end;
$$;

revoke all on function public.integration_sync_health_v1() from public;
grant execute on function public.integration_sync_health_v1() to anon,authenticated,service_role;
notify pgrst,'reload schema';
