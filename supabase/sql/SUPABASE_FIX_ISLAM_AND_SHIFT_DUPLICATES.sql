-- إصلاح تمييز د/ إسلام عن مندوب التوصيل إسلام + إزالة تكرار محمد شماتة من جدول الشيفت
-- شغّل الملف في Supabase SQL Editor مرة واحدة.
-- لا يحذف بيانات؛ فقط يعدّل أسماء العرض وصف الشيفت المكرر.

begin;

-- 1) توحيد اسم دكتور إسلام في جداول الموظفين/الحسابات/الشيفتات
update staff
set name = 'د اسلام فاروق'
where trim(name) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام', 'اسلام')
  and coalesce(role, '') not in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update staff
set display_name = 'د اسلام فاروق'
where trim(coalesce(display_name, '')) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام', 'اسلام')
  and coalesce(role, '') not in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update staff_accounts
set display_name = 'د اسلام فاروق'
where trim(coalesce(display_name, '')) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام', 'اسلام')
  and coalesce(role, '') not in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update shift_schedules
set staff_name = 'د اسلام فاروق'
where trim(coalesce(staff_name, '')) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام')
  and coalesce(role, '') not in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

-- 2) ربط المبيعات القديمة بدكتور إسلام بالاسم الجديد
-- مهم: لا نعدّل اسم إسلام فقط بدون دكتور حتى لا نلمس مندوب التوصيل بالخطأ.
update sales_invoices
set seller_name = 'د اسلام فاروق'
where trim(coalesce(seller_name, '')) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام');

update sales_bills
set seller_name = 'د اسلام فاروق'
where trim(coalesce(seller_name, '')) in ('د اسلام', 'د/ اسلام', 'د. اسلام', 'دكتور اسلام');

-- 3) توحيد اسم مندوب التوصيل إسلام بدون لمس مبيعات الدكتور
update staff
set name = 'اسلام السبع'
where trim(coalesce(name, '')) = 'اسلام'
  and coalesce(role, '') in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update staff
set display_name = 'اسلام السبع'
where trim(coalesce(display_name, '')) = 'اسلام'
  and coalesce(role, '') in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update staff_accounts
set display_name = 'اسلام السبع'
where trim(coalesce(display_name, '')) = 'اسلام'
  and coalesce(role, '') in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

update delivery_riders
set name = 'اسلام السبع'
where trim(coalesce(name, '')) = 'اسلام';

update shift_schedules
set staff_name = 'اسلام السبع'
where trim(coalesce(staff_name, '')) = 'اسلام'
  and coalesce(role, '') in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل');

-- 4) إخفاء شيفت محمد شماتة المكرر الأقصر في فرع شكري
-- الظاهر في الشاشة: 08:00-00:00 و 08:00-12:00. سنوقف 08:00-12:00 حتى لا يظهر مرتين.
update shift_schedules
set is_off = true
where trim(coalesce(staff_name, '')) = 'محمد شماتة'
  and coalesce(branch, '') = 'فرع شكري'
  and coalesce(role, '') in ('توصيل', 'دليفري', 'delivery', 'rider', 'مندوب توصيل')
  and coalesce(shift_start, start_time) = '08:00'
  and coalesce(shift_end, end_time) = '12:00';

commit;

-- فحص سريع بعد التنفيذ
select staff_name, role, branch, shift_start, shift_end, is_off
from shift_schedules
where staff_name in ('محمد شماتة', 'د اسلام فاروق', 'اسلام السبع')
order by branch, staff_name, shift_start;

select seller_name, count(*) as invoices_count, sum(coalesce(net_amount, amount, total_amount, 0)) as sales_total
from sales_invoices
where seller_name like '%اسلام%'
group by seller_name
order by seller_name;
