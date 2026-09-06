-- توحيد تنبيهات المزامنة وإزالة المسارات القديمة المكررة
-- مع عرض نصوص عربية واضحة ومدد زمنية مفهومة للمستخدم.

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
begin
  if p_minutes is null then
    return 'مدة غير معروفة';
  end if;

  v_days := v_minutes / 1440;
  v_hours := (v_minutes % 1440) / 60;
  v_remainder := v_minutes % 60;

  if v_days > 0 then
    if v_hours > 0 then
      return v_days::text || ' يوم و' || v_hours::text || ' ساعة';
    end if;
    return v_days::text || ' يوم';
  elsif v_hours > 0 then
    if v_remainder > 0 then
      return v_hours::text || ' ساعة و' || v_remainder::text || ' دقيقة';
    end if;
    return v_hours::text || ' ساعة';
  end if;

  return v_remainder::text || ' دقيقة';
end;
$$;

revoke all on function public.format_sync_stale_duration_ar_v1(numeric) from public,anon,authenticated;
grant execute on function public.format_sync_stale_duration_ar_v1(numeric) to service_role;

-- إيقاف مراقب المزامنة القديم لأنه ينشئ تنبيهات مكررة بأسماء تقنية.
do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='dawaa-check-sync-health' loop
    perform cron.unschedule(r.jobid);
  end loop;

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

-- إغلاق الحالات القديمة التي كانت تمثل نفس المصادر بأسماء مختلفة.
update public.sync_health_alerts
set resolved=true,
    resolved_at=coalesce(resolved_at, now())
where resolved=false
  and sync_name in (
    'biometric_fingerprint_ingest',
    'dawaawael_customer_order_sync',
    'base44_purchase_invoice_sync'
  );

-- إخفاء الإشعارات القديمة المكررة من عداد "غير مقروء" مع الاحتفاظ بها في السجل.
update public.notifications
set is_read=true,
    read=true,
    status='read'
where (notification_type='sync_health_alert'
       or coalesce(metadata->>'sync_name','') in (
         'biometric_fingerprint_ingest',
         'dawaawael_customer_order_sync',
         'base44_purchase_invoice_sync'
       ))
  and coalesce(is_read,false)=false;

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

  v_duration := public.format_sync_stale_duration_ar_v1(new.minutes_stale);

  if tg_op='INSERT' and new.resolved=false then
    v_status := coalesce(new.details->>'status','delayed');
    v_title := case v_status
      when 'offline' then 'توقف مزامنة ' || v_stream_label
      when 'unknown' then 'تعذر التحقق من مزامنة ' || v_stream_label
      else 'تأخر مزامنة ' || v_stream_label
    end;

    v_message := case
      when new.last_activity_at is null then 'لم يتم رصد اتصال أو مزامنة صالحة لـ ' || v_stream_label || ' حتى الآن.'
      when v_status='offline' then 'آخر نشاط لـ ' || v_stream_label || ' كان منذ ' || v_duration || '. يلزم التحقق من الاتصال.'
      when v_status='unknown' then 'لا تتوفر بيانات كافية لتحديد حالة مزامنة ' || v_stream_label || '.'
      else 'آخر مزامنة لـ ' || v_stream_label || ' كانت منذ ' || v_duration || '.'
    end;

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
      jsonb_build_object(
        'sync_name',new.sync_name,
        'stream_label_ar',v_stream_label,
        'severity',new.severity,
        'minutes_stale',new.minutes_stale,
        'duration_ar',v_duration,
        'details',new.details
      )
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=true then
    v_title := 'تمت استعادة مزامنة ' || v_stream_label;
    v_message := 'عادت مزامنة ' || v_stream_label || ' إلى الحالة الطبيعية.';
    v_key := 'sync-health-resolved:' || new.id::text;

    update public.notifications
    set is_read=true,
        read=true,
        status='read'
    where target_type='sync_health'
      and target_id=new.id::text
      and coalesce(is_read,false)=false;

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

-- تحديث التنبيهات النشطة الحالية إلى صياغة عربية واضحة.
update public.notifications n
set title = case coalesce(n.metadata->>'sync_name','')
      when 'customer_orders' then case coalesce(n.metadata#>>'{details,status}','delayed') when 'offline' then 'توقف مزامنة طلبات العملاء' when 'unknown' then 'تعذر التحقق من مزامنة طلبات العملاء' else 'تأخر مزامنة طلبات العملاء' end
      when 'purchase_invoices' then case coalesce(n.metadata#>>'{details,status}','delayed') when 'offline' then 'توقف مزامنة فواتير المشتريات' when 'unknown' then 'تعذر التحقق من مزامنة فواتير المشتريات' else 'تأخر مزامنة فواتير المشتريات' end
      when 'biometrics' then case coalesce(n.metadata#>>'{details,status}','delayed') when 'offline' then 'توقف اتصال جهاز البصمة' when 'unknown' then 'تعذر التحقق من اتصال جهاز البصمة' else 'تأخر اتصال جهاز البصمة' end
      else n.title end,
    body = case coalesce(n.metadata->>'sync_name','')
      when 'customer_orders' then 'آخر مزامنة لطلبات العملاء كانت منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      when 'purchase_invoices' then 'آخر مزامنة لفواتير المشتريات كانت منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      when 'biometrics' then 'آخر اتصال مسجل لجهاز البصمة كان منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      else n.body end,
    message = case coalesce(n.metadata->>'sync_name','')
      when 'customer_orders' then 'آخر مزامنة لطلبات العملاء كانت منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      when 'purchase_invoices' then 'آخر مزامنة لفواتير المشتريات كانت منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      when 'biometrics' then 'آخر اتصال مسجل لجهاز البصمة كان منذ ' || public.format_sync_stale_duration_ar_v1(nullif(n.metadata->>'minutes_stale','')::numeric) || '.'
      else n.message end
where n.notification_type='sync_health'
  and coalesce(n.metadata->>'sync_name','') in ('customer_orders','purchase_invoices','biometrics');

select public.evaluate_integration_sync_alerts_v1();

notify pgrst,'reload schema';
