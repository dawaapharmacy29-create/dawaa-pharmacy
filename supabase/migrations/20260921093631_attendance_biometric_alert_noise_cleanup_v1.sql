update public.biometric_api_clients
set active=false,updated_at=now()
where provider='fingerprint_vendor_primary'
  and coalesce(last_seen_at,last_success_at,last_request_at)<now()-interval '7 days';

delete from public.sync_health_alerts
where sync_name='biometrics' and resolved=true and detected_at<now()-interval '24 hours';

CREATE OR REPLACE FUNCTION public.evaluate_integration_sync_alerts_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  into v_customer_last,v_customer_pending,v_customer_failed
  from public.customer_requests cr
  where cr.source_system='dawaawael' and cr.source_entity='CustomerOrder';

  select max(ran_at) into v_purchase_last from public.base44_sync_run_log;

  select max(coalesce(last_success_at,last_seen_at,last_request_at))
  into v_bio_last
  from public.biometric_api_clients
  where active=true
    and provider in ('zk_shami_direct_bridge','zk_shokry_direct_bridge');

  v_minutes := case when v_customer_last is null then null else extract(epoch from(v_now-v_customer_last))/60 end;
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
        'status',v_status,'source','dawaawael.CustomerOrder',
        'pending',v_customer_pending,'failed',v_customer_failed,
        'reason',case when v_customer_failed>0 then 'failed_inbox_events' else 'stale_pending_events' end
      ))
    on conflict(sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened:=v_opened+1;
  else
    update public.sync_health_alerts
    set resolved=true,resolved_at=v_now
    where sync_name='customer_orders' and resolved=false;
  end if;

  v_minutes := case when v_purchase_last is null then null else extract(epoch from(v_now-v_purchase_last))/60 end;
  v_status := case when v_minutes is null then 'unknown' when v_minutes<=25 then 'healthy' when v_minutes<=45 then 'delayed' else 'offline' end;
  if v_status in ('delayed','offline','unknown') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'purchase_invoices',v_purchase_last,v_minutes,false,
      case when v_status='offline' or v_status='unknown' then 'critical' else 'warning' end,
      jsonb_build_object('status',v_status,'source','base44.PurchaseInvoice','threshold_minutes',25))
    on conflict(sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened:=v_opened+1;
  else
    update public.sync_health_alerts
    set resolved=true,resolved_at=v_now
    where sync_name='purchase_invoices' and resolved=false;
  end if;

  v_minutes := case when v_bio_last is null then null else extract(epoch from(v_now-v_bio_last))/60 end;
  v_status := case
    when v_minutes is null then 'unknown'
    when v_minutes<=25 then 'healthy'
    when v_minutes<=60 then 'delayed'
    else 'offline' end;

  if v_status in ('delayed','offline','unknown') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'biometrics',v_bio_last,v_minutes,false,
      case when v_status='offline' or v_status='unknown' then 'critical' else 'warning' end,
      jsonb_build_object(
        'status',v_status,
        'source','zk_direct_bridges',
        'threshold_minutes',25,
        'offline_after_minutes',60
      ))
    on conflict(sync_name) where resolved=false do update
      set last_activity_at=excluded.last_activity_at,
          minutes_stale=excluded.minutes_stale,
          severity=excluded.severity,
          details=excluded.details;
    v_opened:=v_opened+1;
  else
    update public.sync_health_alerts
    set resolved=true,resolved_at=v_now
    where sync_name='biometrics' and resolved=false;
  end if;

  delete from public.sync_health_alerts
  where sync_name='biometrics'
    and resolved=true
    and detected_at<v_now-interval '7 days';

  return jsonb_build_object('checked_at',v_now,'streams_needing_attention',v_opened);
end;
$function$

