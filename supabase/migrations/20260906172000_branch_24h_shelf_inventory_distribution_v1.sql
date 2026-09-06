-- 24h branch operations wording + explicit shelf/inventory ownership.
-- Pharmacy branches operate continuously, so task wording avoids open/close semantics.

begin;

-- 1) Normalize visible task wording for 24h operations while keeping the existing
-- timing slot keys for compatibility with current timing logic and historical governance.
update public.staff_daily_checklist_items
set title = 'نظافة الأرضيات — الفترة الصباحية',
    description = 'تنظيف ومسح أرضية الصالة والممرات خلال الفترة الصباحية مع الحفاظ على جاهزية المكان للعملاء طوال التشغيل.'
where item_key = 'clean_floor_open';

update public.staff_daily_checklist_items
set title = 'نظافة الأرضيات — الفترة الليلية',
    description = 'تنظيف ومسح أرضية الصالة والممرات خلال الفترة الليلية مع الحفاظ على جاهزية المكان للتشغيل المستمر.'
where item_key = 'clean_floor_close';

update public.staff_daily_checklist_items
set title = 'نظافة الأرفف والواجهة الزجاجية',
    description = 'تنظيف الأرفف والواجهة الزجاجية من الغبار والبقع وترتيب الجزء الظاهر بصورة مناسبة للعمل المستمر.'
where item_key = 'clean_shelves_glass';

update public.staff_daily_checklist_items
set description = 'تنظيف باب الدخول والمقبض والزجاج المحيط بالمدخل والتأكد من خلوه من الأتربة والبقع أثناء التشغيل.'
where item_key = 'clean_door_entry';

update public.staff_daily_checklist_items
set description = 'تنظيف اليافطة والجزء الظاهر من واجهة الصيدلية والتأكد من عدم وجود أتربة واضحة أثناء التشغيل.'
where item_key = 'clean_signage';

-- 2) Add creams as a first-class shelf zone; do not hide it under generic shelves.
insert into public.staff_daily_checklist_items
  (role,item_key,title,description,requires_photo,time_slot,sort_order,rule_key_on_fail,active,operation_category)
values
  ('مساعد صيدلي','shelf_creams','رص الكريمات والجل والدهانات',
   'مراجعة رص الكريمات والجل والدهانات، إعادة كل صنف لمكانه الصحيح، وترتيب الأقرب انتهاءً بصورة واضحة.',
   true,'أثناء اليوم',23,'assistant_shelf_arrangement_miss',true,'shelf')
on conflict (item_key) do update set
  title=excluded.title,
  description=excluded.description,
  requires_photo=excluded.requires_photo,
  time_slot=excluded.time_slot,
  sort_order=excluded.sort_order,
  rule_key_on_fail=excluded.rule_key_on_fail,
  active=true,
  operation_category='shelf';

-- Keep wording precise for the other shelf zones.
update public.staff_daily_checklist_items
set title='رص الأقراص والكبسولات',
    description='مراجعة رص الأقراص والكبسولات، إعادة كل صنف لمكانه الصحيح، ترتيب الواجهة، وتطبيق الأقرب انتهاءً أولًا.'
where item_key='shelf_tablets';

update public.staff_daily_checklist_items
set title='رص المعمل والمستلزمات',
    description='ترتيب منطقة المعمل والمستلزمات الطبية، تثبيت أماكن الأصناف، ومنع التكدس أو وجود صنف في غير مكانه.'
where item_key='shelf_lab_supplies';

update public.staff_daily_checklist_items
set title='رص الإكسسوار',
    description='ترتيب الإكسسوار ومنتجات العرض حسب الفئة، مواجهة العبوات بصورة منظمة، واستبعاد أي عبوة تالفة أو في غير مكانها.'
where item_key='shelf_accessories';

-- 3) Remove generic assistant ownership for the explicitly distributed shelf zones.
delete from public.staff_daily_checklist_assignments a
using public.staff_daily_checklist_items i
where a.item_id=i.id
  and i.item_key in ('shelf_tablets','shelf_lab_supplies','shelf_accessories','shelf_creams');

-- 4) Explicit shelf ownership by branch + canonical staff id.
-- Shokry: Dr Shaimaa -> accessories.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,'8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,'فرع شكري','daily',null,
       (timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
where i.item_key='shelf_accessories'
on conflict do nothing;

-- Shokry: Youssef Essam -> tablets/capsules.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,'bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,'فرع شكري','daily',null,
       (timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
where i.item_key='shelf_tablets'
on conflict do nothing;

-- El-Shamy: Dr Hoda -> lab/supplies + accessories.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,'d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي','daily',null,
       (timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
where i.item_key in ('shelf_lab_supplies','shelf_accessories')
on conflict do nothing;

-- El-Shamy: Dr Mohamed Elazab -> tablets/capsules + creams/gel/ointments.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,'b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي','daily',null,
       (timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
where i.item_key in ('shelf_tablets','shelf_creams')
on conflict do nothing;

-- 5) Define weekly count responsibilities by the same shelf ownership.
-- These definitions are kept separate per zone so each variance is attributable to
-- the same employee who owns the physical arrangement of that zone.
insert into public.staff_daily_checklist_items
  (role,item_key,title,description,requires_photo,time_slot,sort_order,rule_key_on_fail,active,operation_category)
values
  ('مساعد صيدلي','weekly_inventory_tablets','جرد أسبوعي — الأقراص والكبسولات',
   'تنفيذ قائمة الجرد الأسبوعية الخاصة بالأقراص والكبسولات وتسجيل أي فرق بين الرصيد الفعلي ورصيد النظام.',false,'أثناء اليوم',30,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_supplies','جرد أسبوعي — المعمل والمستلزمات',
   'تنفيذ قائمة الجرد الأسبوعية الخاصة بالمعمل والمستلزمات وتسجيل أي فرق يحتاج مراجعة.',false,'أثناء اليوم',31,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_accessories','جرد أسبوعي — الإكسسوار',
   'تنفيذ قائمة الجرد الأسبوعية الخاصة بالإكسسوار ومنتجات العرض وتسجيل الفروق.',false,'أثناء اليوم',32,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_creams','جرد أسبوعي — الكريمات والجل والدهانات',
   'تنفيذ قائمة الجرد الأسبوعية الخاصة بالكريمات والجل والدهانات وتسجيل أي فرق يحتاج مراجعة.',false,'أثناء اليوم',33,'assistant_inventory_discrepancy',true,'inventory')
on conflict (item_key) do update set
  title=excluded.title,
  description=excluded.description,
  active=true,
  operation_category='inventory';

-- We intentionally do not activate a weekly schedule here because the business has not
-- selected the weekly count day yet. Ownership is recorded as planned assignments so the
-- responsible employee is fixed without inventing a due day.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,x.staff_id,x.branch,'weekly',7,(timezone('Africa/Cairo',now()))::date,false
from public.staff_daily_checklist_items i
join (values
  ('weekly_inventory_accessories'::text,'8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,'فرع شكري'::text),
  ('weekly_inventory_tablets','bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,'فرع شكري'),
  ('weekly_inventory_supplies','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_accessories','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_tablets','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي'),
  ('weekly_inventory_creams','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي')
) as x(item_key,staff_id,branch) on x.item_key=i.item_key
where not exists (
  select 1 from public.staff_daily_checklist_assignments a
  where a.item_id=i.id and a.staff_id=x.staff_id and a.branch=x.branch
);

commit;
