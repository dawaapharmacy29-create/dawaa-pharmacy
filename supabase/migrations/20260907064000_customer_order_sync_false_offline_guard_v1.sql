-- Avoid treating an idle customer-order stream as an outage.
-- Customer orders do not currently expose a dedicated transport heartbeat,
-- so lack of new orders alone must not be classified as offline.

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
  v_customer_last timestamptz;
  v_customer_pending int := 0;
  v_customer_failed int := 0;
  v_customer_age_seconds int;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not exists (
    select 1 from public.staff_accounts sa
    where sa.id=v_actor_id and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true
  ) then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  select greatest(
      max(cr.source_last_seen_at),
      (select max(i.received_at) from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder'),
      (select max(i.processed_at) from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder')
    ),
    (select count(*)::int from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder' and i.processing_status in ('received','pending','processing')),
    (select count(*)::int from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder' and i.processing_status in ('conflict','rejected','failed'))
  into v_customer_last, v_customer_pending, v_customer_failed
  from public.customer_requests cr
  where cr.source_system='dawaawael' and cr.source_entity='CustomerOrder';

  v_customer_age_seconds := case when v_customer_last is null then null else greatest(0, extract(epoch from (v_now-v_customer_last))::int) end;

  select jsonb_build_object(
    'stream','customer_orders',
    'source_system','dawaawael',
    'source_entity','CustomerOrder',
    'total_canonical',count(*)::int,
    'last_source_updated_at',max(source_updated_at),
    'last_seen_at',v_customer_last,
    -- This stream has event activity but no dedicated heartbeat. Expose age only while work is queued/failed.
    'heartbeat_age_seconds',case when v_customer_pending>0 or v_customer_failed>0 then v_customer_age_seconds else null end,
    'activity_age_seconds',v_customer_age_seconds,
    'activity_state',case when v_customer_pending=0 and v_customer_failed=0 and (v_customer_age_seconds is null or v_customer_age_seconds>1200) then 'idle' else 'active' end,
    'status',case
      when v_customer_failed>0 then 'delayed'
      when v_customer_pending>0 and v_customer_age_seconds is null then 'delayed'
      when v_customer_pending>0 and v_customer_age_seconds>3600 then 'offline'
      when v_customer_pending>0 and v_customer_age_seconds>1200 then 'delayed'
      else 'healthy' end,
    'inbox_pending',v_customer_pending,
    'inbox_failed',v_customer_failed,
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

create or replace function public.evaluate_integration_sync_alerts_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_now timestamptz := now();
  v_customer_last timestamptz;
  v_purchase_last timestamptz;
  v_bio_last timestamptz;
  v_customer_pending int := 0;
  v_customer_failed int := 0;
  v_minutes numeric;
  v_opened int := 0;
  v_status text;
begin
  select greatest(
      max(cr.source_last_seen_at),
      (select max(i.received_at) from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder'),
      (select max(i.processed_at) from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder')
    ),
    (select count(*)::int from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder' and i.processing_status in ('received','pending','processing')),
    (select count(*)::int from public.customer_request_sync_inbox i where i.source_system='dawaawael' and i.source_entity='CustomerOrder' and i.processing_status in ('conflict','rejected','failed'))
  into v_customer_last, v_customer_pending, v_customer_failed
  from public.customer_requests cr
  where cr.source_system='dawaawael' and cr.source_entity='CustomerOrder';

  select max(ran_at) into v_purchase_last from public.base44_sync_run_log;
  select max(last_seen_at) into v_bio_last from public.biometric_api_clients where active=true;

  -- Customer orders: no dedicated transport heartbeat exists yet.
  -- Only alert when there is concrete backlog/failure evidence; quiet traffic alone is not an outage.
  v_minutes := case when v_customer_last is null then null else extract(epoch from (v_now-v_customer_last))/60 end;
  v_status := case
    when v_customer_failed>0 then 'delayed'
    when v_customer_pending>0 and v_minutes is null then 'delayed'
    when v_customer_pending>0 and v_minutes>60 then 'offline'
    when v_customer_pending>0 and v_minutes>20 then 'delayed'
    else 'healthy' end;

  if v_status in ('delayed','offline') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'customer_orders',v_customer_last,v_minutes,false,
      case when v_status='offline' then 'critical' else 'warning' end,
      jsonb_build_object(
        'status',v_status,
        'source','dawaawael.CustomerOrder',
        'pending',v_customer_pending,
        'failed',v_customer_failed,
        'reason',case when v_customer_failed>0 then 'failed_inbox_events' else 'stale_pending_events' end
      ))
    on conflict (sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened := v_opened + 1;
  else
    update public.sync_health_alerts set resolved=true,resolved_at=v_now
    where sync_name='customer_orders' and resolved=false;
  end if;

  -- Purchases: reconciliation heartbeat runs every 15 minutes, so alert after 25 minutes.
  v_minutes := case when v_purchase_last is null then null else extract(epoch from (v_now-v_purchase_last))/60 end;
  v_status := case when v_minutes is null then 'unknown' when v_minutes <= 25 then 'healthy' when v_minutes <= 45 then 'delayed' else 'offline' end;
  if v_status in ('delayed','offline','unknown') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'purchase_invoices',v_purchase_last,v_minutes,false,case when v_status='offline' or v_status='unknown' then 'critical' else 'warning' end,
      jsonb_build_object('status',v_status,'source','base44.PurchaseInvoice','threshold_minutes',25))
    on conflict (sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened := v_opened + 1;
  else
    update public.sync_health_alerts set resolved=true,resolved_at=v_now
    where sync_name='purchase_invoices' and resolved=false;
  end if;

  -- Biometrics: continuous agent heartbeat is authoritative.
  v_minutes := case when v_bio_last is null then null else extract(epoch from (v_now-v_bio_last))/60 end;
  v_status := case when v_minutes is null then 'unknown' when v_minutes <= 10 then 'healthy' when v_minutes <= 20 then 'delayed' else 'offline' end;
  if v_status in ('delayed','offline','unknown') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'biometrics',v_bio_last,v_minutes,false,case when v_status='offline' or v_status='unknown' then 'critical' else 'warning' end,
      jsonb_build_object('status',v_status,'source','fingerprint_vendor_primary','threshold_minutes',10))
    on conflict (sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened := v_opened + 1;
  else
    update public.sync_health_alerts set resolved=true,resolved_at=v_now
    where sync_name='biometrics' and resolved=false;
  end if;

  return jsonb_build_object('checked_at',v_now,'streams_needing_attention',v_opened);
end;
$$;

revoke all on function public.integration_sync_health_v1() from public;
grant execute on function public.integration_sync_health_v1() to anon,authenticated,service_role;
revoke all on function public.evaluate_integration_sync_alerts_v1() from public,anon,authenticated;
grant execute on function public.evaluate_integration_sync_alerts_v1() to service_role;

select public.evaluate_integration_sync_alerts_v1();
notify pgrst,'reload schema';
