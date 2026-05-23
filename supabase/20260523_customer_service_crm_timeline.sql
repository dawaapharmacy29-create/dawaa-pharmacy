-- Dawaa Pharmacy 2027 - Customer Service CRM Timeline
-- شغّل الملف بعد ملفات 2027 وطلبات العملاء لتفعيل سجل المتابعات الكامل.

alter table public.daily_followups add column if not exists followup_type text;
alter table public.daily_followups add column if not exists priority text default 'عادي';
alter table public.daily_followups add column if not exists contact_method text;
alter table public.daily_followups add column if not exists followup_summary text;
alter table public.daily_followups add column if not exists followup_result text;
alter table public.daily_followups add column if not exists next_followup_date date;
alter table public.daily_followups add column if not exists request_type text;
alter table public.daily_followups add column if not exists request_details text;
alter table public.daily_followups add column if not exists request_status text;
alter table public.daily_followups add column if not exists purchase_after_followup boolean default false;
alter table public.daily_followups add column if not exists purchase_invoice_no text;
alter table public.daily_followups add column if not exists purchase_amount numeric default 0;
alter table public.daily_followups add column if not exists purchase_date date;
alter table public.daily_followups add column if not exists closed_at timestamptz;
alter table public.daily_followups add column if not exists created_by text;
alter table public.daily_followups add column if not exists created_by_name text;

-- فهارس لتسريع السجل والبحث والفلاتر
create index if not exists idx_daily_followups_customer_code on public.daily_followups(customer_code);
create index if not exists idx_daily_followups_customer_phone on public.daily_followups(customer_phone);
create index if not exists idx_daily_followups_status on public.daily_followups(status);
create index if not exists idx_daily_followups_priority on public.daily_followups(priority);
create index if not exists idx_daily_followups_request_type on public.daily_followups(request_type);
create index if not exists idx_daily_followups_next_date on public.daily_followups(next_followup_date);
create index if not exists idx_daily_followups_closed_at on public.daily_followups(closed_at);
create index if not exists idx_daily_followups_created_at on public.daily_followups(created_at desc);

-- قواعد تقييم مبدئية لخدمة العملاء لو جدول قواعد 2027 موجود
insert into public.evaluation_rules (
  rule_key, title, description, type, category, points, role_scope,
  is_repeatable, requires_approval, is_active, created_at, updated_at
)
select * from (values
  ('CS_EXCEPTIONAL_FOLLOWUP_CREATED', 'تسجيل متابعة استثنائية كاملة البيانات', 'مكافأة عند تسجيل متابعة استثنائية واضحة بها سبب وعميل ومسؤول.', 'reward', 'خدمة العملاء', 5, 'customer_service', false, false, true, now(), now()),
  ('CS_FOLLOWUP_WITH_REQUEST_CLOSED', 'إغلاق طلب عميل بنجاح من المتابعة', 'مكافأة عند تحويل طلب أو متابعة إلى نتيجة مغلقة أو شراء فعلي.', 'reward', 'خدمة العملاء', 10, 'customer_service', false, true, true, now(), now()),
  ('CS_MISSING_FOLLOWUP_SUMMARY', 'متابعة بدون ملخص واضح', 'خصم عند حفظ متابعة بدون ملخص واضح لما حدث مع العميل.', 'penalty', 'خدمة العملاء', 10, 'customer_service', true, false, true, now(), now()),
  ('CS_LATE_URGENT_FOLLOWUP', 'تأخير متابعة عاجلة', 'خصم عند تأخير متابعة عاجلة أو خطر عن موعدها.', 'penalty', 'خدمة العملاء', 20, 'customer_service', true, true, true, now(), now()),
  ('CS_REQUEST_NOT_UPDATED', 'طلب عميل بدون تحديث حالة', 'خصم عند ترك طلب عميل مفتوح بدون تحديث أو ملاحظة.', 'penalty', 'طلبات العملاء', 15, 'customer_service,purchasing', true, false, true, now(), now())
) as v(rule_key, title, description, type, category, points, role_scope, is_repeatable, requires_approval, is_active, created_at, updated_at)
where exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'evaluation_rules'
)
on conflict (rule_key) do nothing;

notify pgrst, 'reload schema';

select 'Customer Service CRM Timeline schema ready' as status;
