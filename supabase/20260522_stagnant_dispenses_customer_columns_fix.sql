-- إصلاح أعمدة العميل في جدول صرف أدوية الرواكد
-- شغّل الملف كاملًا في Supabase SQL Editor ثم اعمل Refresh للصفحة.
alter table public.stagnant_medicine_dispenses add column if not exists customer_id text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_name text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_code text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_phone text;
alter table public.stagnant_medicine_dispenses add column if not exists invoice_no text;
alter table public.stagnant_medicine_dispenses add column if not exists notes text;

-- تحديث تعليق الجدول لإجبار PostgREST على تحديث الـ schema cache غالبًا
comment on table public.stagnant_medicine_dispenses is 'Stagnant medicine dispense logs with customer metadata - refreshed 2026-05-22';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'stagnant_medicine_dispenses'
  and column_name in ('customer_id','customer_name','customer_code','customer_phone','invoice_no','notes')
order by column_name;
