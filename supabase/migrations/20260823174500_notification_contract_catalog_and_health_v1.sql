create table if not exists public.notification_type_catalog (
  type text primary key,
  category text not null,
  audience_scope text not null,
  default_route text,
  default_priority text not null default 'normal',
  is_active boolean not null default true,
  is_legacy boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.notification_type_catalog(type, category, audience_scope, default_route, default_priority, is_active, is_legacy, description)
values
 ('conversation_review','personal_performance','staff','/reviews','normal',true,false,'تقييم محادثة موجه للموظف'),
 ('reward','personal_performance','staff','/doctor-dashboard?tab=activity','normal',true,false,'مكافأة/نقاط موجبة للموظف'),
 ('penalty','personal_performance','staff','/doctor-dashboard?tab=activity','high',true,false,'خصم/نقاط سالبة للموظف'),
 ('vip_customer_silence','customer_service','staff_branch','/customer-service','high',true,false,'عميل مهم متوقف عن الشراء'),
 ('daily_customer_attention_digest','customer_service','staff_branch','/customer-service','normal',true,false,'ملخص يومي لمتابعات العملاء'),
 ('daily_followup_queue_missing','customer_service','staff','/customer-service','high',true,false,'قائمة المتابعات اليومية لم تتولد'),
 ('branch_manager_checklist_gap','management_escalation','branches_manager','/daily-manager-checklist','high',true,false,'تأخر مديرة فرع في المهام اليومية'),
 ('doctor_performance_drop','branch_operations','branch_manager','/performance-pillars','high',true,false,'تراجع أداء دكتور داخل الفرع'),
 ('reminder','management_reminder','staff_role','/weekly-evaluation/branch_manager','normal',true,false,'تذكير إداري'),
 ('attendance','attendance','staff_branch','/attendance-report','normal',true,false,'تنبيه حضور/انصراف'),
 ('expiry_alert','inventory','staff','/medicine-expiry','high',true,false,'تنبيه صلاحية دواء'),
 ('customer_request','customer_service','staff_branch','/customer-service','normal',false,true,'نوع قديم لطلبات/متابعات العملاء'),
 ('followup','customer_service','staff_branch','/customer-service','normal',false,true,'نوع متابعة قديم'),
 ('customer_alert','customer_service','staff_branch','/customer-coding','normal',false,true,'تنبيه عميل قديم'),
 ('deduction','personal_performance','staff','/staff-dashboard','high',false,true,'نوع خصم قديم'),
 ('customer_service_progress','customer_service','staff','/customer-service','normal',false,true,'تنبيه تقدم قائمة خدمة العملاء القديم'),
 ('customer_service_incomplete','customer_service','staff','/customer-service','high',false,true,'تنبيه عدم اكتمال قائمة خدمة العملاء القديم')
on conflict (type) do update set
 category=excluded.category,
 audience_scope=excluded.audience_scope,
 default_route=excluded.default_route,
 default_priority=excluded.default_priority,
 is_active=excluded.is_active,
 is_legacy=excluded.is_legacy,
 description=excluded.description,
 updated_at=now();

update public.notifications
set type = case title
  when 'مكافأة جديدة' then 'reward'
  when 'خصم مسجل على حسابك' then 'penalty'
  when 'تنبيه تقدم قائمة خدمة العملاء' then 'customer_service_progress'
  when 'قائمة خدمة العملاء لم تكتمل' then 'customer_service_incomplete'
  else type end,
    notification_type = coalesce(notification_type, case title
  when 'مكافأة جديدة' then 'reward'
  when 'خصم مسجل على حسابك' then 'penalty'
  when 'تنبيه تقدم قائمة خدمة العملاء' then 'customer_service_progress'
  when 'قائمة خدمة العملاء لم تكتمل' then 'customer_service_incomplete'
  else notification_type end),
    target_type = coalesce(target_type, case title
  when 'مكافأة جديدة' then 'employee_transaction'
  when 'خصم مسجل على حسابك' then 'employee_transaction'
  when 'تنبيه تقدم قائمة خدمة العملاء' then 'customer_service_progress'
  when 'قائمة خدمة العملاء لم تكتمل' then 'customer_service_progress'
  else target_type end),
    target_route = coalesce(target_route, case title
  when 'مكافأة جديدة' then '/doctor-dashboard?tab=activity'
  when 'خصم مسجل على حسابك' then '/doctor-dashboard?tab=activity'
  when 'تنبيه تقدم قائمة خدمة العملاء' then '/customer-service'
  when 'قائمة خدمة العملاء لم تكتمل' then '/customer-service'
  else target_route end),
    route = coalesce(route, case title
  when 'مكافأة جديدة' then '/doctor-dashboard?tab=activity'
  when 'خصم مسجل على حسابك' then '/doctor-dashboard?tab=activity'
  when 'تنبيه تقدم قائمة خدمة العملاء' then '/customer-service'
  when 'قائمة خدمة العملاء لم تكتمل' then '/customer-service'
  else route end)
where type is null and title in ('مكافأة جديدة','خصم مسجل على حسابك','تنبيه تقدم قائمة خدمة العملاء','قائمة خدمة العملاء لم تكتمل');

create or replace function public.dawaa_notification_require_type_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.type := nullif(btrim(coalesce(new.type, new.notification_type, '')), '');
  if new.type is null then
    raise exception 'notification type is required';
  end if;
  new.notification_type := coalesce(nullif(btrim(coalesce(new.notification_type,'')),''), new.type);
  return new;
end;
$$;

drop trigger if exists trg_notifications_require_type_v1 on public.notifications;
create trigger trg_notifications_require_type_v1
before insert or update on public.notifications
for each row execute function public.dawaa_notification_require_type_v1();

create or replace view public.notification_delivery_health_v1 as
select
  sa.id as account_id,
  sa.staff_id,
  sa.name,
  sa.role,
  sa.branch,
  max(n.created_at) as last_notification_at,
  count(n.id) filter (where n.created_at >= now() - interval '24 hours') as notifications_24h,
  count(n.id) filter (where n.created_at >= now() - interval '7 days') as notifications_7d,
  count(n.id) filter (where n.created_at >= now() - interval '7 days' and coalesce(n.is_read,n.read,false)=false) as unread_7d,
  count(n.id) filter (where n.created_at >= now() - interval '7 days' and c.category='management_escalation') as management_escalations_7d,
  count(n.id) filter (where n.created_at >= now() - interval '7 days' and c.category='branch_operations') as branch_operations_7d
from public.staff_accounts sa
left join public.notifications n on n.recipient_staff_id = sa.staff_id
left join public.notification_type_catalog c on c.type = n.type
where sa.active = true and sa.can_login = true
group by sa.id, sa.staff_id, sa.name, sa.role, sa.branch;
