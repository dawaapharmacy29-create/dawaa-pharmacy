-- تحديث نص التنبيه المفتوح كلما تغيّرت مدة التأخير أو الحالة،
-- وتحسين صياغة المدد العربية وتنظيف رسائل الاستعادة القديمة.

create or replace function public.format_sync_stale_duration_ar_v1(p_minutes numeric)
returns text
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
declare
  v_minutes integer := greatest(0, coalesce(round(p_minutes), 0));
  v_days integer;
  v_hours integer;
  v_remainder integer;
  v_day_text text;
  v_hour_text text;
  v_minute_text text;
begin
  if p_minutes is null then
    return 'مدة غير معروفة';
  end if;

  v_days := v_minutes / 1440;
  v_hours := (v_minutes % 1440) / 60;
  v_remainder := v_minutes % 60;

  v_day_text := case
    when v_days = 1 then 'يوم واحد'
    when v_days = 2 then 'يومين'
    when v_days between 3 and 10 then v_days::text || ' أيام'
    else v_days::text || ' يومًا'
  end;
  v_hour_text := case
    when v_hours = 1 then 'ساعة واحدة'
    when v_hours = 2 then 'ساعتين'
    when v_hours between 3 and 10 then v_hours::text || ' ساعات'
    else v_hours::text || ' ساعة'
  end;
  v_minute_text := case
    when v_remainder = 1 then 'دقيقة واحدة'
    when v_remainder = 2 then 'دقيقتين'
    when v_remainder between 3 and 10 then v_remainder::text || ' دقائق'
    else v_remainder::text || ' دقيقة'
  end;

  if v_days > 0 then
    return v_day_text || case when v_hours > 0 then ' و' || v_hour_text else '' end;
  elsif v_hours > 0 then
    return v_hour_text || case when v_remainder > 0 then ' و' || v_minute_text else '' end;
  end if;

  return v_minute_text;
end;
$$;

create or replace function public.notify_sync_health_alert_transition_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_stream_label text;
  v_status text;
  v_title text;
  v_message text;
  v_key text;
  v_duration text;
begin
  v_stream_label := case new.sync_name
    when 'customer_orders' then 'طلبات العملاء'
    when 'purchase_invoices' then 'فواتير المشتريات'
    when 'biometrics' then 'جهاز البصمة'
    when 'dawaawael_customer_order_sync' then 'طلبات العملاء'
    when 'base44_purchase_invoice_sync' then 'فواتير المشتريات'
    when 'biometric_fingerprint_ingest' then 'جهاز البصمة'
    else 'مصدر المزامنة' end;

  v_status := coalesce(new.details->>'status','delayed');
  v_duration := public.format_sync_stale_duration_ar_v1(new.minutes_stale);
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
    v_key := 'sync-health-open:' || new.id::text;
    insert into public.notifications(
      title,body,message,type,notification_type,priority,status,is_read,read,
      recipient_role,target_type,target_id,target_route,route,requires_action,
      action_status,sound_required,sound_enabled,dedupe_key,is_global,metadata
    ) values (
      v_title,v_message,v_message,'system','sync_health',
      case when new.severity='critical' then 'urgent' else 'high' end,
      'unread',false,false,'general_manager','sync_health',new.id::text,
      '/attendance-report?tab=sync','/attendance-report?tab=sync',true,'new',
      new.severity='critical',new.severity='critical',v_key,false,
      jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details)
    ) on conflict (dedupe_key) where dedupe_key is not null do update
      set title=excluded.title,
          body=excluded.body,
          message=excluded.message,
          priority=excluded.priority,
          metadata=excluded.metadata,
          sound_required=excluded.sound_required,
          sound_enabled=excluded.sound_enabled;

  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=false then
    update public.notifications
    set title=v_title,
        body=v_message,
        message=v_message,
        priority=case when new.severity='critical' then 'urgent' else 'high' end,
        sound_required=new.severity='critical',
        sound_enabled=new.severity='critical',
        metadata=jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'severity',new.severity,'minutes_stale',new.minutes_stale,'duration_ar',v_duration,'details',new.details)
    where target_type='sync_health'
      and target_id=new.id::text
      and notification_type='sync_health';

  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=true then
    update public.notifications
    set is_read=true,read=true,status='read'
    where target_type='sync_health' and target_id=new.id::text and coalesce(is_read,false)=false;

    v_title := 'تمت استعادة مزامنة ' || v_stream_label;
    v_message := 'عادت مزامنة ' || v_stream_label || ' إلى الحالة الطبيعية.';
    v_key := 'sync-health-resolved:' || new.id::text;

    insert into public.notifications(
      title,body,message,type,notification_type,priority,status,is_read,read,
      recipient_role,target_type,target_id,target_route,route,requires_action,
      action_status,sound_required,sound_enabled,dedupe_key,is_global,metadata
    ) values (
      v_title,v_message,v_message,'system','sync_health','normal','unread',false,false,
      'general_manager','sync_health',new.id::text,'/attendance-report?tab=sync','/attendance-report?tab=sync',
      false,'new',false,false,v_key,false,
      jsonb_build_object('sync_name',new.sync_name,'stream_label_ar',v_stream_label,'resolved_at',new.resolved_at)
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_health_alert_notifications_v1 on public.sync_health_alerts;
create trigger trg_sync_health_alert_notifications_v1
after insert or update of resolved,minutes_stale,severity,details,last_activity_at on public.sync_health_alerts
for each row execute function public.notify_sync_health_alert_transition_v1();

-- ترجمة رسائل الاستعادة التي أنشأها المراقب القديم أثناء الإغلاق النهائي.
update public.notifications
set title = case coalesce(metadata->>'sync_name','')
      when 'dawaawael_customer_order_sync' then 'تم إيقاف تنبيه المزامنة القديم لطلبات العملاء'
      when 'biometric_fingerprint_ingest' then 'تم إيقاف تنبيه المزامنة القديم لجهاز البصمة'
      when 'base44_purchase_invoice_sync' then 'تم إيقاف تنبيه المزامنة القديم لفواتير المشتريات'
      else title end,
    body = case coalesce(metadata->>'sync_name','')
      when 'dawaawael_customer_order_sync' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      when 'biometric_fingerprint_ingest' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      when 'base44_purchase_invoice_sync' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      else body end,
    message = case coalesce(metadata->>'sync_name','')
      when 'dawaawael_customer_order_sync' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      when 'biometric_fingerprint_ingest' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      when 'base44_purchase_invoice_sync' then 'تم استبدال مسار المراقبة القديم بالنظام الموحد الجديد.'
      else message end,
    is_read=true,
    read=true,
    status='read'
where notification_type='sync_health'
  and coalesce(metadata->>'sync_name','') in ('dawaawael_customer_order_sync','biometric_fingerprint_ingest','base44_purchase_invoice_sync');

select public.evaluate_integration_sync_alerts_v1();
notify pgrst,'reload schema';
