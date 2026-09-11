-- One sync incident should have one notification lifecycle.
-- Resolve/update the original alert instead of emitting a second recovery notification.

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
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details,'incidentState','open'),
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
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details,'incidentState','open'),
      p_sound_enabled => new.severity='critical'
    );
  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=true then
    perform public.update_system_notification_v2(
      p_dedupe_key => v_open_key,
      p_title => 'تمت استعادة مزامنة ' || v_stream_label,
      p_message => 'عادت مزامنة ' || v_stream_label || ' إلى الحالة الطبيعية.',
      p_priority => 'low',
      p_metadata => jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'resolved_at',new.resolved_at,'incidentState','resolved','isRecovery',true),
      p_resolved => true,
      p_sound_enabled => false
    );
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';