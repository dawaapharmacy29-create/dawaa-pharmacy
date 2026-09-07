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
begin
  v_stream_label := case new.sync_name
    when 'customer_orders' then 'طلبات العملاء'
    when 'purchase_invoices' then 'فواتير المشتريات'
    when 'biometrics' then 'البصمات'
    else 'مسار المزامنة' end;

  if tg_op='INSERT' and new.resolved=false then
    v_status := coalesce(new.details->>'status','delayed');
    v_title := 'تنبيه مزامنة: ' || v_stream_label;
    v_message := case
      when new.last_activity_at is null then 'لم يتم رصد اتصال أو مزامنة صالحة للمصدر.'
      else 'المزامنة ' || case when v_status='offline' then 'متوقفة' else 'متأخرة' end || ' منذ نحو ' || coalesce(round(new.minutes_stale)::text,'غير محدد') || ' دقيقة.'
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
      '/system-integrations','/system-integrations',true,'new',
      new.severity='critical',new.severity='critical',v_key,false,
      jsonb_build_object('sync_name',new.sync_name,'severity',new.severity,'minutes_stale',new.minutes_stale,'details',new.details)
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

  elsif tg_op='UPDATE' and old.resolved=false and new.resolved=true then
    v_title := 'تمت استعادة المزامنة: ' || v_stream_label;
    v_message := 'عاد مسار ' || v_stream_label || ' إلى الحالة الطبيعية بعد التنبيه السابق.';
    v_key := 'sync-health-resolved:' || new.id::text;

    insert into public.notifications(
      title,body,message,type,notification_type,priority,status,is_read,read,
      recipient_role,target_type,target_id,target_route,route,requires_action,
      action_status,sound_required,sound_enabled,dedupe_key,is_global,metadata
    ) values (
      v_title,v_message,v_message,'system','sync_health','normal','unread',false,false,
      'general_manager','sync_health',new.id::text,'/system-integrations','/system-integrations',
      false,'new',false,false,v_key,false,
      jsonb_build_object('sync_name',new.sync_name,'resolved_at',new.resolved_at)
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

-- توجيه التنبيهات القائمة التي لم تُقرأ بعد إلى المركز الجديد أيضًا.
update public.notifications
set target_route='/system-integrations', route='/system-integrations'
where notification_type='sync_health'
  and coalesce(is_read,false)=false;

notify pgrst,'reload schema';
