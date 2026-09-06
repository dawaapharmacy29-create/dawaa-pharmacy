alter table public.sync_health_alerts
  add column if not exists severity text,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists resolved_at timestamptz;

create unique index if not exists ux_sync_health_alerts_open_stream
  on public.sync_health_alerts(sync_name)
  where resolved=false;

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
  v_minutes numeric;
  v_opened int := 0;
  v_status text;
begin
  select max(source_last_seen_at) into v_customer_last
  from public.customer_requests
  where source_system='dawaawael' and source_entity='CustomerOrder';

  select max(ran_at) into v_purchase_last from public.base44_sync_run_log;
  select max(last_seen_at) into v_bio_last from public.biometric_api_clients where active=true;

  -- Customer orders: live events are primary, 5-minute reconciliation is the safety net.
  v_minutes := case when v_customer_last is null then null else extract(epoch from (v_now-v_customer_last))/60 end;
  v_status := case when v_minutes is null then 'unknown' when v_minutes <= 10 then 'healthy' when v_minutes <= 20 then 'delayed' else 'offline' end;
  if v_status in ('delayed','offline','unknown') then
    insert into public.sync_health_alerts(detected_at,sync_name,last_activity_at,minutes_stale,resolved,severity,details)
    values(v_now,'customer_orders',v_customer_last,v_minutes,false,case when v_status='offline' or v_status='unknown' then 'critical' else 'warning' end,
      jsonb_build_object('status',v_status,'source','dawaawael.CustomerOrder','threshold_minutes',10))
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

  -- Biometrics: target continuous agent heartbeat, alert after 10 minutes.
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

revoke all on function public.evaluate_integration_sync_alerts_v1() from public,anon,authenticated;
grant execute on function public.evaluate_integration_sync_alerts_v1() to service_role;

select public.evaluate_integration_sync_alerts_v1();

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='dawaa_integration_sync_alerts_v1' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule(
    'dawaa_integration_sync_alerts_v1',
    '*/5 * * * *',
    $cron$select public.evaluate_integration_sync_alerts_v1();$cron$
  );
end;
$$;

notify pgrst,'reload schema';
