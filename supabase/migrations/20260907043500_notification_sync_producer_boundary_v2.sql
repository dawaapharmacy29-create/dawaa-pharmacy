-- Finish database producer cleanup for sync alerts.

create or replace function public.update_system_notification_v2(
  p_dedupe_key text,
  p_title text default null,
  p_message text default null,
  p_priority text default null,
  p_metadata jsonb default null,
  p_resolved boolean default false,
  p_sound_enabled boolean default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text := nullif(trim(coalesce(p_dedupe_key,'')),'');
  v_count integer := 0;
begin
  if v_key is null then return false; end if;

  update public.notifications
  set title = coalesce(nullif(trim(coalesce(p_title,'')),''), title),
      message = coalesce(p_message, message),
      body = coalesce(p_message, body),
      priority = case when p_priority in ('low','normal','high','urgent','critical') then p_priority else priority end,
      metadata = case when p_metadata is null then metadata else coalesce(metadata,'{}'::jsonb) || p_metadata end,
      sound_enabled = coalesce(p_sound_enabled, sound_enabled),
      is_read = case when p_resolved then true else is_read end,
      read = case when p_resolved then true else read end,
      status = case when p_resolved then 'read' else status end,
      read_at = case when p_resolved then coalesce(read_at,now()) else read_at end
  where dedupe_key = v_key;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.update_system_notification_v2(text,text,text,text,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.update_system_notification_v2(text,text,text,text,jsonb,boolean,boolean) to service_role;

create or replace function public.notify_sync_health_alert_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stream_label text;
  v_status text;
  v_title text;
  v_message text;
  v_key text;
  v_duration text;
  v_open_key text;
begin
  v_stream_label := case new.sync_name
    when 'customer_orders' then 'طلبات العملاء'
    when 'purchase_invoices' then 'فواتير المشتريات'
    when 'biometrics' then 'جهاز البصمة'
    when 'dawaawael_customer_order_sync' then 'طلبات العملاء'
    when 'base44_purchase_invoice_sync' then 'فواتير المشتريات'
    when 'biometric_fingerprint_ingest' then 'جهاز البصمة'
    else 'مصدر المزامنة'
  end;
  v_status := coalesce(new.details->>'status','delayed');
  v_duration := public.format_sync_stale_duration_ar_v1(new.minutes_stale);
  v_open_key := 'sync-health-open:' || new.id::text;
  v_title := case v_status
    when 'offline' then case when new.sync_name='biometrics' then 'توقف اتصال جهاز البصمة' else 'توقف مزامنة ' || v_stream_label end
    when 'unknown' then 'تعذر التحقق من مزامنة ' || v_stream_label
    else 'تأخر مزامنة ' || v_stream_label
  end;
  v_message := case
    when new.last_activity_at is null then 'لم يتم رصد اتصال أو مزامنة صالحة لـ ' || v_stream_label || ' حتى الآن.'
    when new.sync_name='biometrics' then 'آخر اتصال مسجل لجهاز البصمة كان منذ ' || v_duration || '.'
    when v_status='offline' then 'آخر نشاط لمزامنة ' || v_stream_label || ' كان منذ ' || v_duration || '. يلزم التحقق من الاتصال.'
    when v_status='unknown' then 'لا تتوفر بيانات كافية لتحديد حالة مزامنة ' || v_stream_label || '.'
    else 'آخر مزامنة لـ ' || v_stream_label || ' كانت منذ ' || v_duration || '.'
  end;

  if tg_op='INSERT' and new.resolved=false then
    perform public.emit_system_notification_v2(
      p_recipient_role => 'general_manager',
      p_notification_type => 'system',
      p_title => v_title,
      p_message => v_message,
      p_entity_type => 'sync_health',
      p_entity_id => new.id::text,
      p_action_url => '/attendance-report?tab=sync',
      p_priority => case when new.severity='critical' then 'urgent' else 'high' end,
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details),
      p_dedupe_key => v_open_key,
      p_requires_action => true,
      p_sound_enabled => new.severity='critical'
    );
  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=false then
    perform public.update_system_notification_v2(
      p_dedupe_key => v_open_key,
      p_title => v_title,
      p_message => v_message,
      p_priority => case when new.severity='critical' then 'urgent' else 'high' end,
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details),
      p_sound_enabled => new.severity='critical'
    );
  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=true then
    perform public.update_system_notification_v2(
      p_dedupe_key => v_open_key,
      p_resolved => true,
      p_sound_enabled => false
    );
    v_title := 'تمت استعادة مزامنة ' || v_stream_label;
    v_message := 'عادت مزامنة ' || v_stream_label || ' إلى الحالة الطبيعية.';
    v_key := 'sync-health-resolved:' || new.id::text;
    perform public.emit_system_notification_v2(
      p_recipient_role => 'general_manager',
      p_notification_type => 'system',
      p_title => v_title,
      p_message => v_message,
      p_entity_type => 'sync_health',
      p_entity_id => new.id::text,
      p_action_url => '/attendance-report?tab=sync',
      p_priority => 'normal',
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'resolved_at',new.resolved_at),
      p_dedupe_key => v_key,
      p_requires_action => false,
      p_sound_enabled => false
    );
  end if;
  return new;
end;
$$;

-- Legacy health entry point now delegates to the single integration evaluator.
create or replace function public.check_sync_health_v1()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select public.evaluate_integration_sync_alerts_v1();
$$;
