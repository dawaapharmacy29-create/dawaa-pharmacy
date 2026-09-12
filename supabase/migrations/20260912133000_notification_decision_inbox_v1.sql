create or replace function public.notification_signal_family_v1(
  p_type text,
  p_target_type text,
  p_metadata jsonb default '{}'::jsonb
) returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_type,'')) in ('customer_followup','customer_request','customer_data_review','welcome_task','vip_customer_silence','customer_alert')
      or lower(coalesce(p_target_type,'')) like '%customer%' then 'customers'
    when lower(coalesce(p_type,''))='conversation_review' then 'reviews'
    when lower(coalesce(p_type,''))='staff_task' or lower(coalesce(p_target_type,'')) like '%task%' then 'tasks'
    when lower(coalesce(p_type,'')) in ('attendance','shift_issue') then 'hr'
    when lower(coalesce(p_type,'')) in ('inventory','expiry_alert') then 'inventory'
    when lower(coalesce(p_type,'')) in ('reward','deduction','payroll') then 'performance'
    when lower(coalesce(p_type,''))='sales_target' then 'sales'
    when lower(coalesce(p_type,''))='delivery_order' then 'delivery'
    when lower(coalesce(p_type,''))='manager_alert' then 'management'
    when lower(coalesce(p_type,''))='system' then 'system'
    else 'other'
  end;
$$;

create or replace function public.notification_signal_tier_v1(
  p_type text,
  p_priority text,
  p_title text,
  p_message text,
  p_requires_action boolean,
  p_sla_ack_breached boolean,
  p_sla_resolution_breached boolean,
  p_metadata jsonb default '{}'::jsonb
) returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_metadata->>'slaGenerated','false'))='true' then 'reference'
    when lower(coalesce(p_type,'')) in ('branch_manager_operational_digest','daily_customer_attention_digest','vip_customer_health_digest','daily_task_reminder')
      or lower(coalesce(p_metadata->>'signalTier',''))='digest'
      or lower(coalesce(p_title,'')) like '%ملخص%'
      or lower(coalesce(p_title,'')) like '%تقرير حركة%' then 'digest'
    when lower(coalesce(p_priority,''))='critical' then 'critical'
    when lower(coalesce(p_priority,''))='urgent' then 'critical'
    when coalesce(p_sla_resolution_breached,false) then 'critical'
    when lower(coalesce(p_type,''))='system' and (
      lower(coalesce(p_title,'')) like '%توقف%'
      or lower(coalesce(p_message,'')) like '%offline%'
      or lower(coalesce(p_message,'')) like '%تعذر%'
    ) then 'critical'
    when lower(coalesce(p_type,''))='vip_customer_silence' and (
      lower(coalesce(p_title,'')) like '%توقف عن الشراء%'
      or lower(coalesce(p_title,'')) like '%تراجع قوي%'
    ) then 'critical'
    when coalesce(p_requires_action,false) then 'action'
    when coalesce(p_sla_ack_breached,false) then 'attention'
    when lower(coalesce(p_priority,''))='high' then 'attention'
    else 'info'
  end;
$$;

create or replace function public.notification_signal_rank_v1(p_tier text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_tier,''))
    when 'critical' then 500
    when 'action' then 400
    when 'attention' then 300
    when 'digest' then 200
    when 'info' then 100
    when 'reference' then 10
    else 0
  end;
$$;

create or replace view public.notification_decision_inbox_v1
with (security_invoker=true)
as
select
  n.*,
  public.notification_signal_family_v1(n.canonical_type,n.target_type,n.metadata) as signal_family,
  t.signal_tier,
  public.notification_signal_rank_v1(t.signal_tier)
    + case when n.open_action then 30 else 0 end
    + case when n.unread then 10 else 0 end
    + case when n.sla_resolution_breached then 25 when n.sla_ack_breached then 15 else 0 end
    as signal_rank,
  case t.signal_tier
    when 'critical' then 'يحتاج تدخلًا سريعًا أو توجد مشكلة تشغيلية مؤثرة'
    when 'action' then 'يتطلب إجراء أو قرارًا واضحًا'
    when 'attention' then 'يحتاج مراجعة ومتابعة اليوم'
    when 'digest' then 'ملخص دوري للمراجعة بدون إنشاء مهام متعددة'
    when 'reference' then 'مرجع تاريخي مرتبط بتنبيه أصلي وليس مسار عمل مستقل'
    else 'للعلم والتوثيق'
  end as signal_reason,
  (t.signal_tier='reference') as reference_only
from public.notification_events_v3 n
cross join lateral (
  select public.notification_signal_tier_v1(
    n.canonical_type,n.priority,n.title,n.message,n.requires_action,
    n.sla_ack_breached,n.sla_resolution_breached,n.metadata
  ) as signal_tier
) t;

revoke all on public.notification_decision_inbox_v1 from public;
grant select on public.notification_decision_inbox_v1 to anon, authenticated, service_role;
