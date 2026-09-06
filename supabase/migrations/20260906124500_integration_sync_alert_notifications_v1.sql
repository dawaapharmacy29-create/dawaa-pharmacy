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
    else new.sync_name end;

  if tg_op='INSERT' and new.resolved=false then
    v_status := coalesce(new.details->>'status','delayed');
    v_title := 'تنبيه مزامنة: ' || v_stream_label;
    v_message := case
      when new.last_activity_at is null then 'لم يتم رصد اتصال أو مزامنة صالحة للمصدر.'
      else 'المزامنة ' || case when v_status='offline' then 'متوقفة' else 'متأخرة' end || ' منذ نحو ' || coalesce(round(new.minutes_stale)::text,'?') || ' دقيقة.'
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
      'general_manager','sync_health',new.id::text,'/attendance-report?tab=sync','/attendance-report?tab=sync',
      false,'new',false,false,v_key,false,
      jsonb_build_object('sync_name',new.sync_name,'resolved_at',new.resolved_at)
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_health_alert_notifications_v1 on public.sync_health_alerts;
create trigger trg_sync_health_alert_notifications_v1
after insert or update of resolved on public.sync_health_alerts
for each row execute function public.notify_sync_health_alert_transition_v1();

insert into public.notifications(
  title,body,message,type,notification_type,priority,status,is_read,read,
  recipient_role,target_type,target_id,target_route,route,requires_action,
  action_status,sound_required,sound_enabled,dedupe_key,is_global,metadata
)
select
  'تنبيه مزامنة: ' || case a.sync_name when 'customer_orders' then 'طلبات العملاء' when 'purchase_invoices' then 'فواتير المشتريات' when 'biometrics' then 'البصمات' else a.sync_name end,
  'المزامنة متأخرة أو متوقفة منذ نحو ' || coalesce(round(a.minutes_stale)::text,'?') || ' دقيقة.',
  'المزامنة متأخرة أو متوقفة منذ نحو ' || coalesce(round(a.minutes_stale)::text,'?') || ' دقيقة.',
  'system','sync_health',case when a.severity='critical' then 'urgent' else 'high' end,'unread',false,false,
  'general_manager','sync_health',a.id::text,'/attendance-report?tab=sync','/attendance-report?tab=sync',true,'new',
  a.severity='critical',a.severity='critical','sync-health-open:'||a.id::text,false,
  jsonb_build_object('sync_name',a.sync_name,'severity',a.severity,'minutes_stale',a.minutes_stale,'details',a.details)
from public.sync_health_alerts a
where a.resolved=false
on conflict (dedupe_key) where dedupe_key is not null do nothing;
